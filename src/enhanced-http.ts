import { InstrumentationOption } from "@opentelemetry/instrumentation";
import { BetterHttpInstrumentation, BetterHttpInstrumentationOptions } from "./http.ts";
import { EnhancedUndiciInstrumentation } from "./enhanced-undici.ts";
import { enableFetchBodyCapture } from "./fetch-interceptor.ts";
import { patchConsole, registerOTel } from "./console-logger.ts";

export interface EnhancedHttpInstrumentationOptions extends BetterHttpInstrumentationOptions {
    /**
     * Enable full fetch body capture using response interception
     * This provides complete request/response body capture for fetch calls
     * but requires monkey-patching the global fetch function
     * @default true
     */
    enableFetchBodyCapture?: boolean;
    /**
     * Enable undici instrumentation for undici-based requests (used by Vercel)
     * @default true
     */
    enableUndiciInstrumentation?: boolean;
    /**
     * Enable console log interception to send logs to OpenTelemetry
     * @default true
     */
    enableConsoleLogging?: boolean;
    /**
     * Service name for OpenTelemetry traces and logs
     * @default 'nextjs-app'
     */
    serviceName?: string;
    /**
     * Force enable both undici and fetch instrumentation
     * When true, both interceptors will be enabled regardless of environment detection
     * @default true
     */
    enableDualSupport?: boolean;
}

/**
 * Detect the current runtime environment
 */
function detectEnvironment(): { isVercel: boolean; isLocal: boolean; isNode: boolean; hasFetch: boolean; hasUndici: boolean } {
    const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NEXT_RUNTIME === 'edge');
    const isLocal = !!(process.env.NODE_ENV === 'development' || (!process.env.VERCEL && !process.env.VERCEL_ENV));
    const isNode = !!(typeof process !== 'undefined' && process.versions && process.versions.node);
    const hasFetch = typeof globalThis.fetch === 'function';

    // Check if undici is available
    let hasUndici = false;
    try {
        require.resolve('undici');
        hasUndici = true;
    } catch {
        // undici not available
        hasUndici = false;
    }

    return { isVercel, isLocal, isNode, hasFetch, hasUndici };
}

/**
 * Enhanced HTTP Instrumentation with support for both undici and fetch
 * Automatically detects environment and enables appropriate interceptors
 */
export function getEnhancedHttpInstrumentations(options: EnhancedHttpInstrumentationOptions = {}): InstrumentationOption[] {
    const instrumentations: InstrumentationOption[] = [];
    const env = detectEnvironment();

    // Initialize console logging if enabled (default: true)
    if (options.enableConsoleLogging !== false) {
        const serviceName = options.serviceName || process.env.OTEL_SERVICE_NAME || 'nextjs-app';
        registerOTel(serviceName);
        patchConsole();
    }

    // ALWAYS include server-side HTTP instrumentation for incoming Next.js requests
    // This is configured to only instrument incoming requests, not outgoing client calls
    instrumentations.push(new BetterHttpInstrumentation({
        ...options,
        // Disable outgoing request instrumentation to prevent conflicts with specialized interceptors
        ignoreOutgoingRequestHook: () => true, // Skip all outgoing requests
        // Only instrument incoming server requests
        ignoreIncomingRequestHook: options.ignoreIncomingRequestHook,
    }));

    // Determine which interceptors to enable based on environment and options
    const shouldEnableFetch = options.enableFetchBodyCapture !== false && env.hasFetch;
    const shouldEnableUndici = options.enableUndiciInstrumentation !== false && env.hasUndici;
    const enableDualSupport = options.enableDualSupport !== false;

    console.log(`[otel-nextjs] Environment detected: ${JSON.stringify(env)}`);
    console.log(`[otel-nextjs] Interceptors to enable: fetch=${shouldEnableFetch}, undici=${shouldEnableUndici}, dual=${enableDualSupport}`);

    // Track which interceptors were successfully enabled for fallback logic
    let fetchEnabled = false;
    let undiciEnabled = false;

    // Enable fetch interceptor for regular fetch calls (local development and modern Node.js)
    if (shouldEnableFetch) {
        try {
            enableFetchBodyCapture({
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
                maxBodySize: 5242880, // 5MB
            });
            fetchEnabled = true;
            console.log('[otel-nextjs] Fetch body capture enabled successfully');
        } catch (error) {
            console.warn('[otel-nextjs] Failed to enable fetch body capture:', error instanceof Error ? error.message : error);
        }
    }

    // Enable undici instrumentation for undici-based requests (Vercel and other environments using undici)
    if (shouldEnableUndici) {
        try {
            instrumentations.push(new EnhancedUndiciInstrumentation({
                requireParentforSpans: options.requireParentforOutgoingSpans,
                captureRequestBody: options.captureBody,
                captureResponseBody: options.captureBody,
                captureHeaders: options.captureHeaders,
            }));
            undiciEnabled = true;
            console.log('[otel-nextjs] Enhanced undici instrumentation enabled successfully');
        } catch (error) {
            console.warn('[otel-nextjs] Failed to enable undici instrumentation:', error instanceof Error ? error.message : error);
        }
    }

    // Fallback logic: If neither interceptor is enabled, provide a warning and guidance
    if (!fetchEnabled && !undiciEnabled) {
        console.error('[otel-nextjs] ERROR: No HTTP interceptors were successfully enabled!');
        console.error('[otel-nextjs] This means outgoing HTTP requests will not be traced.');
        console.error('[otel-nextjs] Please check your configuration and ensure dependencies are available.');

        if (!env.hasFetch && !env.hasUndici) {
            console.error('[otel-nextjs] Neither fetch nor undici appear to be available in this environment.');
        }
    } else if (env.isVercel && !undiciEnabled) {
        console.warn('[otel-nextjs] WARNING: Running on Vercel but undici instrumentation failed to enable.');
        console.warn('[otel-nextjs] You may miss some HTTP requests that use undici.');
        if (fetchEnabled) {
            console.warn('[otel-nextjs] Fetch interceptor is active as fallback.');
        }
    } else if (env.isLocal && !fetchEnabled) {
        console.warn('[otel-nextjs] WARNING: Running locally but fetch interceptor failed to enable.');
        console.warn('[otel-nextjs] You may miss some HTTP requests that use regular fetch.');
        if (undiciEnabled) {
            console.warn('[otel-nextjs] Undici instrumentation is active as fallback.');
        }
    }

    // If dual support is disabled and we're in a specific environment, show a warning
    if (!enableDualSupport) {
        if (env.isVercel && !shouldEnableUndici) {
            console.warn('[otel-nextjs] Warning: Running on Vercel but undici instrumentation is disabled. You may miss some HTTP traces.');
        }
        if (env.isLocal && !shouldEnableFetch) {
            console.warn('[otel-nextjs] Warning: Running locally but fetch interceptor is disabled. You may miss some HTTP traces.');
        }
    }

    return instrumentations;
}

/**
 * Enhanced HTTP Instrumentation that supports both undici and fetch with environment detection
 * This is the recommended way to set up HTTP instrumentation for Next.js applications
 */
export function createUniversalHttpInstrumentation(options: EnhancedHttpInstrumentationOptions = {}): InstrumentationOption[] {
    return getEnhancedHttpInstrumentations({
        enableDualSupport: true,
        enableFetchBodyCapture: true,
        enableUndiciInstrumentation: true,
        ...options
    });
}

/**
 * Backwards compatible BetterHttpInstrumentation 
 * @deprecated Use getEnhancedHttpInstrumentations() or createUniversalHttpInstrumentation() for better support
 */
export class EnhancedHttpInstrumentation extends BetterHttpInstrumentation {
    constructor(options: BetterHttpInstrumentationOptions = {}) {
        super(options);

        console.warn('[otel-nextjs] EnhancedHttpInstrumentation: This class may create duplicate spans. Use getEnhancedHttpInstrumentations() or createUniversalHttpInstrumentation() instead.');
    }
}