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
      // Automatically includes:
      // - HTTP instrumentation for Node.js requests
      // - Undici instrumentation for Next.js fetch with payload capture
      // - Full request/response body and header capture (non-binary only)
      // - Response body capture enabled by default
    });

    sdk.start();
  }
}
```

## Features

### 🚀 **Automatic Next.js Support**
- Traces both server-side requests (HTTP) and client-side fetch calls (Undici)
- Zero configuration required for Next.js applications

### 📝 **Smart Payload Capture**
- Automatically captures request/response bodies and headers
- Skips binary content (images, videos, file uploads) to avoid large traces
- Configurable size limits (default: 10KB)
- Supports JSON, form data, and text content
- **Full fetch response body capture** with optional interception

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

### Advanced Configuration

```javascript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { KubiksSDK, StripePlugin, getEnhancedHttpInstrumentations } = await import('@kubiks/otel-nextjs');

    const sdk = new KubiksSDK({
      serverless: true,
      service: "your-project-name",
      // Add custom instrumentations alongside defaults
      instrumentations: [
        ...getEnhancedHttpInstrumentations({ 
          plugins: [
            new StripePlugin() // Add custom plugins
          ],
          enableFetchBodyCapture: true, // Full body capture
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
      includeDefaultInstrumentations: false, // Disable defaults
      instrumentations: [
        // Provide your own instrumentations
        new BetterHttpInstrumentation()
      ]
    });

    sdk.start();
  }
}
```

## Universal HTTP Instrumentation (Recommended)

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

This approach:
- **Automatically detects** whether you're running locally or on Vercel
- **Enables fetch interceptor** for local development (where Next.js uses regular fetch)
- **Enables undici instrumentation** for Vercel deployment (where Vercel uses undici)
- **Supports both simultaneously** for maximum compatibility
- **Provides detailed logging** about which interceptors are enabled

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

### Migration from Previous Versions

If you're currently using `getEnhancedHttpInstrumentations()`, you can simply replace it with `createUniversalHttpInstrumentation()` for better dual support:

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