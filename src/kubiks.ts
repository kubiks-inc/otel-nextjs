import { BatchSpanProcessor, NodeTracerProvider, SimpleSpanProcessor, Sampler, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import api, { Attributes, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { DetectorSync, detectResourcesSync, Resource, ResourceAttributes } from '@opentelemetry/resources';
import { awsLambdaDetector } from '@opentelemetry/resource-detector-aws'
import { VercelDetector } from './resources/vercel.ts';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { InstrumentationOption, registerInstrumentations } from '@opentelemetry/instrumentation';
import { ServiceDetector } from './resources/service.ts';
// Intentionally do not import HTTP/Undici instrumentations to keep this SDK focused on logs and manual spans

type KubiksSDKOpts = {
    instrumentations?: InstrumentationOption[],
    collectorUrl?: string,
    kubiksKey?: string,
    service?: string,
    log?: boolean,
    namespace?: string,
    serverless?: boolean
    sampler?: Sampler
    resourceDetectors?: DetectorSync[],
    resourceAttributes?: Resource | Attributes
    /**
     * Whether to include default instrumentations.
     * Defaults to false to avoid auto-instrumenting HTTP/Undici.
     * Provide your own instrumentations via options.instrumentations if desired.
     * @default false
     */
    includeDefaultInstrumentations?: boolean
    /**
     * Enable full fetch response body capture using fetch interception
     * This provides complete request/response body capture for fetch calls
     * @default true
     */
    enableFetchBodyCapture?: boolean
}

/**
 * Default instrumentations are intentionally disabled to ensure the SDK does not
 * auto-instrument HTTP or undici. Users may pass their own instrumentations via
 * the `instrumentations` option when constructing the SDK.
 */
function getDefaultInstrumentations(options: KubiksSDKOpts = {}): InstrumentationOption[] {
    return [];
}

/**
 * KubiksSDK is a wrapper around the OpenTelemetry NodeSDK that configures it to send traces to Kubiks.
 * 
 * By default, includes HTTP and Undici instrumentation with Vercel plugin for Next.js compatibility.
 * 
 * @param {InstrumentationOption[]} options.instrumentations - Additional OpenTelemetry instrumentations to enable alongside defaults.
 * @param {boolean} options.includeDefaultInstrumentations - Whether to include default instrumentations (HTTP, Undici, Vercel). Defaults to true.
 * @param {boolean} options.enableFetchBodyCapture - Enable full fetch response body capture using interception. Defaults to true.
 * @param {string} options.kubiksKey - The Kubiks API key. Defaults to the KUBIKS_KEY environment variable.
 * @param {string} options.service - The name of the service. 
 * @param {string} options.namespace - The namespace of the service.
 * @param {boolean} options.serverless - Whether or not the service is running in a serverless environment. Defaults to false.
 * @param {boolean} options.log - Whether or not to enable the log exporter. Defaults to false.
 * @param {string} options.collectorUrl - The URL of the Kubiks collector. Defaults to https://otlp.kubiks.ai/v1
 * @param {Sampler} options.sampler - The OpenTelemetry sampler to use. Defaults to No Sampling.
 */
export class KubiksSDK {
    options: KubiksSDKOpts;
    attributes: ResourceAttributes;
    constructor(options: KubiksSDKOpts = {}) {
        // Auto-detect serverless to ensure immediate export of spans
        const detectedServerless =
            !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
            !!process.env.AWS_EXECUTION_ENV ||
            !!process.env.VERCEL;

        options.serverless = options.serverless ?? detectedServerless;
        options.collectorUrl = options.collectorUrl || process.env.COLLECTOR_URL || "https://otlp.kubiks.ai";
        options.kubiksKey = options.kubiksKey || process.env.KUBIKS_API_KEY || process.env.KUBIKS_KEY;
        // Default to false to avoid enabling HTTP/Undici instrumentation automatically
        options.includeDefaultInstrumentations = options.includeDefaultInstrumentations === true ? true : false;
        options.enableFetchBodyCapture = options.enableFetchBodyCapture !== false; // Default to true

        this.options = options;
    }

    start() {
        if (process.env.OTEL_LOG_LEVEL === "debug") {
            api.diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL);
        }
        // If a tracer provider is already registered globally (e.g., by @vercel/otel),
        // attach our exporter to it so manual spans created via @opentelemetry/api
        // are exported to Kubiks as well.
        const globalProvider: any = (api as any).trace?.getTracerProvider?.();
        const existingDelegate: any = typeof globalProvider?.getDelegate === 'function' ? globalProvider.getDelegate() : undefined;

        // configure exporters (shared for both paths below)
        let exporter: OTLPTraceExporter | ConsoleSpanExporter | undefined = undefined;

        if (!this.options.kubiksKey) {
            console.warn("No Kubiks API key provided. Traces will be sent without authentication headers.")
        }

        // Always create OTLP exporter, with or without API key
        let collectorUrl = this.options.collectorUrl;
        const tracesEndpoint = collectorUrl + "/v1/traces";

        exporter = new OTLPTraceExporter({
            url: tracesEndpoint,
            headers: this.options.kubiksKey ? {
                "X-Kubiks-Key": this.options.kubiksKey || process.env.KUBIKS_KEY || process.env.KUBIKS_OTEL_KEY,
            } : {},
            timeoutMillis: 1000,
        });

        console.log(`[KubiksSDK] Traces will be exported to: ${tracesEndpoint}`);

        // Override with console exporter if log option is enabled
        if (this.options.log) {
            exporter = new ConsoleSpanExporter();
            console.log("[KubiksSDK] Using console exporter for traces (log option enabled)");
        }

        if (existingDelegate && typeof existingDelegate.addSpanProcessor === 'function') {
            // Attach to existing provider (e.g., @vercel/otel)
            const spanProcessor = this.options.serverless ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter, {
                maxQueueSize: 100,
                maxExportBatchSize: 5,
            });
            existingDelegate.addSpanProcessor(spanProcessor);

            // Register instrumentations regardless; they use the global provider
            const allInstrumentations = [
                ...(this.options.includeDefaultInstrumentations ? getDefaultInstrumentations(this.options) : []),
                ...(this.options.instrumentations || [])
            ];
            registerInstrumentations({
                instrumentations: allInstrumentations
            });

            console.log('[KubiksSDK] Attached Kubiks exporter to existing global tracer provider');
            return existingDelegate;
        }

        const provider = new NodeTracerProvider({
            sampler: this.options.sampler,
            resource: detectResourcesSync({
                detectors: [
                    awsLambdaDetector,
                    new VercelDetector(),
                    ...(this.options.resourceDetectors || []),
                    new ServiceDetector({ serviceName: this.options.service, attributes: this.options.resourceAttributes })
                ],
            }),
            forceFlushTimeoutMillis: 5000,
        });

        // In serverless environments, use SimpleSpanProcessor to avoid buffer loss
        const spanProcessor = this.options.serverless ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter, {
            maxQueueSize: 100,
            maxExportBatchSize: 5,
        });

        provider.addSpanProcessor(spanProcessor);

        // Ensure a proper async context manager is registered so manual spans and
        // instrumentations propagate context across async boundaries.
        // This is especially important outside of the full NodeSDK.
        // Prefer AsyncLocalStorage-based context manager for better compatibility
        // with React/Next.js server runtimes.
        const contextManager = new AsyncHooksContextManager().enable();
        provider.register({ contextManager });

        // Combine default instrumentations with user-provided ones
        const allInstrumentations = [
            ...(this.options.includeDefaultInstrumentations ? getDefaultInstrumentations(this.options) : []),
            ...(this.options.instrumentations || [])
        ];

        registerInstrumentations({
            instrumentations: allInstrumentations
        });
        return provider;
    }
}