import React from 'react';
import {
  WebsiteHandler,
  CreateHandlerOptions,
  WebsiteHandlerError,
  HandlerComponentProps,
} from './types';

/**
 * Creates a website handler with built-in error handling and validation
 */
export function createWebsiteHandler(options: CreateHandlerOptions): WebsiteHandler {
  const { name, patterns, component, shouldReplace = false, priority = 0, config = {} } = options;

  // Validate options
  if (!name || typeof name !== 'string') {
    throw new Error('Handler name must be a non-empty string');
  }

  if (!patterns) {
    throw new Error('Handler patterns must be provided');
  }

  if (!component) {
    throw new Error('Handler component must be provided');
  }

  // Create test function from patterns
  const testFunction = Array.isArray(patterns)
    ? (url: string) => patterns.some((pattern) => pattern.test(url))
    : patterns;

  return {
    name,
    priority,
    config: {
      enabled: true,
      timeout: 5000,
      maxRetries: 3,
      ...config,
    },
    test: (url: string) => {
      try {
        if (!config.enabled) return false;
        return testFunction(url);
      } catch (error) {
        throw new WebsiteHandlerError(
          `Test function failed for handler "${name}"`,
          name,
          url,
          error
        );
      }
    },
    handle: (url: string) => {
      try {
        if (!config.enabled) return null;

        return {
          type: shouldReplace ? 'embed' : 'enhanced-preview',
          component,
          shouldReplace,
          priority,
          metadata: {
            handlerName: name,
            url,
          },
        };
      } catch (error) {
        throw new WebsiteHandlerError(
          `Handle function failed for handler "${name}"`,
          name,
          url,
          error
        );
      }
    },
  };
}

/**
 * Creates an error boundary wrapper for handler components
 */
export function withErrorBoundary<P extends HandlerComponentProps>(
  Component: React.ComponentType<P>,
  handlerName: string
): React.ComponentType<P> {
  return class ErrorBoundaryWrapper extends React.Component<
    P,
    { hasError: boolean; error?: Error }
  > {
    constructor(props: P) {
      super(props);
      this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error } {
      return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
      console.error(`Website handler "${handlerName}" component error:`, error, errorInfo);
    }

    render() {
      if (this.state.hasError) {
        return React.createElement(
          'div',
          {
            style: {
              padding: '1rem',
              border: '1px solid #e5e7eb',
              borderRadius: '0.375rem',
              backgroundColor: '#fef2f2',
              color: '#dc2626',
            },
          },
          `Error loading ${handlerName} preview`
        );
      }

      return React.createElement(Component, this.props);
    }
  };
}

/**
 * Makes a proxied fetch request through a configured proxy server.
 *
 * This version uses a proxy path format similar to:
 * curl "http://127.0.0.1:8080/proxy/https://video.twimg.com/...mp4"
 *
 * @param url - The original URL to fetch through the proxy
 * @param options - Optional fetch options
 * @returns Promise<Response> - The fetch response from the proxied request
 */
 export async function fetchProxied(
  url: string, 
  proxyServer: string | undefined, 
  options: RequestInit = {}
): Promise<Response> {
  if (!proxyServer) {
    throw new Error('Proxy server is not configured');
  }

  try {
    // Remove protocol from proxyServer if present
    const cleanProxyServer = proxyServer.replace(/^https?:\/\//, '');
    const proxyUrl = `https://${cleanProxyServer}/proxy/${url}`;

    const response = await fetch(proxyUrl, {
      ...options,
    });

    return response;
  } catch (error) {
    throw new Error(
      `Failed to make proxied request to ${url}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}
