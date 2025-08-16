# NextJS Kubiks OpenTelemetry SDK

Instrument your Node.js applications with OpenTelemetry and send the traces to [Kubiks](https://kubiks.ai).

![Kubiks ServiceMap](./content/servicemap.png)
  
## Example

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      // Note: HTTP auto-instrumentation is disabled by default.
      // You can still add instrumentations manually via the `instrumentations` option.
    });

    sdk.start();
  }
}
```

## Features

### 🚀 **Manual Next.js Support**
- By default this SDK focuses on logs and manual spans.
- Add HTTP or Undici instrumentations manually if desired (see below).

### 📝 **Optional Payload Capture (manual)**
- You can opt-in to request/response body and header capture by adding HTTP instrumentations manually.

### 🔧 **Flexible Configuration**
- Works out-of-the-box with sensible defaults
- Fully customizable for advanced use cases
- Backwards compatible with existing setups

### Disable Response Body Capture (if needed)

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      enableFetchBodyCapture: false, // Disable if you don't want response bodies
    });

    sdk.start();
  }
}
```

### Add HTTP Instrumentation Manually (Optional)

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK, StripePlugin, getEnhancedHttpInstrumentations } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      // Add instrumentations explicitly
      instrumentations: [
        ...getEnhancedHttpInstrumentations({ 
          plugins: [
            new StripePlugin()
          ],
          enableFetchBodyCapture: true,
        }),
        // Add other instrumentations here
      ]
    });

    sdk.start();
  }
}
```

### Disable Default Instrumentations

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK, BetterHttpInstrumentation } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      includeDefaultInstrumentations: false, // Defaults to false in this version
      instrumentations: [
        // Provide your own instrumentations
        new BetterHttpInstrumentation()
      ]
    });

    sdk.start();
  }
}
```

## Universal HTTP Instrumentation (Optional)

For Next.js applications that need to work both locally (with `npm run dev`) and on Vercel, use the universal HTTP instrumentation that automatically detects the environment and enables both undici and fetch interceptors:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { createUniversalHttpInstrumentation } from '@kubiks/otel-nextjs';

const sdk = new NodeSDK({
  instrumentations: [
    ...createUniversalHttpInstrumentation({
      captureBody: true,
      captureHeaders: true,
      serviceName: 'my-nextjs-app'
    })
  ],
});

sdk.start();
```

This approach, when added manually, can:
- Enable fetch interceptor for local development
- Enable undici instrumentation for Vercel deployment
- Support both simultaneously for compatibility

### Environment Detection & Logging

The library automatically detects your environment and logs which interceptors are enabled:

```bash
# When running locally (npm run dev)
[otel-nextjs] Environment detected: {"isVercel":false,"isLocal":true,"isNode":true,"hasFetch":true,"hasUndici":true}
[otel-nextjs] Interceptors to enable: fetch=true, undici=true, dual=true
[otel-nextjs] Fetch body capture enabled successfully
[otel-nextjs] Enhanced undici instrumentation enabled successfully

# When running on Vercel
[otel-nextjs] Environment detected: {"isVercel":true,"isLocal":false,"isNode":true,"hasFetch":true,"hasUndici":true}
[otel-nextjs] Interceptors to enable: fetch=true, undici=true, dual=true
[otel-nextjs] Fetch body capture enabled successfully
[otel-nextjs] Enhanced undici instrumentation enabled successfully
```

## Environment Variables

The SDK supports several environment variables for configuration:

| Variable | Description | Default |
|----------|-------------|---------|
| `OTEL_SERVICE_NAME` | Sets the service name for all telemetry data | `nextjs-app` |
| `KUBIKS_API_KEY` | API key for Kubiks (can also use `KUBIKS_KEY`) | - |
| `COLLECTOR_URL` | Custom OTLP collector URL | `https://otlp.kubiks.ai` |
| `OTEL_LOG_LEVEL` | Enable debug logging when set to `debug` | - |
| `NEXT_RUNTIME` | Detected automatically by Next.js | - |

### Service Name Configuration

You can set the service name in multiple ways (in order of precedence):

```javascript
// 1. Explicit service parameter (highest priority)
const sdk = new KubiksSDK({
  service: "my-explicit-service-name"
});

// 2. OTEL_SERVICE_NAME environment variable
// export OTEL_SERVICE_NAME=my-service-from-env

// 3. Default fallback
// Will use "nextjs-app" if neither above are set
```

### Migration from Previous Versions

If you're currently using `getEnhancedHttpInstrumentations()`, you can replace it with `createUniversalHttpInstrumentation()` for dual support:

```typescript
// Before (still works, but may miss some requests)
const instrumentations = getEnhancedHttpInstrumentations({
  captureBody: true,
  captureHeaders: true
});

// After (recommended - ensures both undici and fetch are captured)
const instrumentations = createUniversalHttpInstrumentation({
  captureBody: true,
  captureHeaders: true
});
```

### Manual Configuration

If you need more control, you can configure interceptors manually:

```typescript
import { getEnhancedHttpInstrumentations } from '@kubiks/otel-nextjs';

const instrumentations = getEnhancedHttpInstrumentations({
  enableFetchBodyCapture: true,       // Enable fetch interceptor
  enableUndiciInstrumentation: true,   // Enable undici instrumentation
  enableDualSupport: true,            // Enable both (recommended)
  captureBody: true,
  captureHeaders: true,
  serviceName: 'my-app'
});
```