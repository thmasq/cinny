import { useCallback, useEffect, useRef } from 'react';
import { useResizeObserver } from './useResizeObserver';

interface EmbedResizeHandlerOptions {
  /** Called when an embed resizes */
  onEmbedResize?: (element: HTMLElement, size: { width: number; height: number }) => void;
  /** Called when loading state changes */
  onLoadingStateChange?: (isLoading: boolean) => void;
  /** Debounce delay in milliseconds */
  debounceMs?: number;
}

export interface EmbedResizeHandler {
  /** Ref to attach to the embed container */
  embedRef: React.RefObject<HTMLElement>;
  /** Register an embed element for resize observation */
  registerEmbed: (element: HTMLElement) => void;
  /** Unregister an embed element */
  unregisterEmbed: (element: HTMLElement) => void;
  /** Mark embed as loading */
  setLoading: (loading: boolean) => void;
  /** Check if any embeds are currently loading */
  isLoading: boolean;
}

export const useEmbedResizeHandler = (
  options: EmbedResizeHandlerOptions = {}
): EmbedResizeHandler => {
  const { onEmbedResize, onLoadingStateChange, debounceMs = 100 } = options;
  
  const embedRef = useRef<HTMLElement>(null);
  const observedElements = useRef<Set<HTMLElement>>(new Set());
  const loadingStates = useRef<Map<HTMLElement, boolean>>(new Map());
  const previousSizes = useRef<Map<HTMLElement, { width: number; height: number }>>(new Map());
  const debounceTimers = useRef<Map<HTMLElement, NodeJS.Timeout>>(new Map());

  const handleResize = useCallback(
    (element: HTMLElement, size: { width: number; height: number }) => {
      const previousSize = previousSizes.current.get(element);
      
      // Only trigger if size actually changed significantly (>1px)
      if (
        !previousSize ||
        Math.abs(previousSize.width - size.width) > 1 ||
        Math.abs(previousSize.height - size.height) > 1
      ) {
        previousSizes.current.set(element, size);
        onEmbedResize?.(element, size);
      }
    },
    [onEmbedResize]
  );

  const debouncedHandleResize = useCallback(
    (element: HTMLElement, size: { width: number; height: number }) => {
      // Clear existing timer for this element
      const existingTimer = debounceTimers.current.get(element);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new timer
      const timer = setTimeout(() => {
        handleResize(element, size);
        debounceTimers.current.delete(element);
      }, debounceMs);

      debounceTimers.current.set(element, timer);
    },
    [handleResize, debounceMs]
  );

  const resizeObserver = useResizeObserver(
    useCallback(
      (entries) => {
        entries.forEach((entry) => {
          const element = entry.target as HTMLElement;
          if (observedElements.current.has(element)) {
            const size = {
              width: entry.contentRect.width,
              height: entry.contentRect.height,
            };
            debouncedHandleResize(element, size);
          }
        });
      },
      [debouncedHandleResize]
    ),
    useCallback(() => null, []) // No default element to observe
  );

  const registerEmbed = useCallback(
    (element: HTMLElement) => {
      if (!observedElements.current.has(element)) {
        observedElements.current.add(element);
        resizeObserver?.observe(element);
        
        // Store initial size
        const rect = element.getBoundingClientRect();
        previousSizes.current.set(element, {
          width: rect.width,
          height: rect.height,
        });
      }
    },
    [resizeObserver]
  );

  const unregisterEmbed = useCallback(
    (element: HTMLElement) => {
      if (observedElements.current.has(element)) {
        observedElements.current.delete(element);
        loadingStates.current.delete(element);
        previousSizes.current.delete(element);
        
        // Clear any pending timer
        const timer = debounceTimers.current.get(element);
        if (timer) {
          clearTimeout(timer);
          debounceTimers.current.delete(element);
        }
        
        resizeObserver?.unobserve(element);
      }
    },
    [resizeObserver]
  );

  const setLoading = useCallback(
    (loading: boolean) => {
      const element = embedRef.current;
      if (element) {
        const wasLoading = Array.from(loadingStates.current.values()).some(Boolean);
        loadingStates.current.set(element, loading);
        const isLoading = Array.from(loadingStates.current.values()).some(Boolean);
        
        if (wasLoading !== isLoading) {
          onLoadingStateChange?.(isLoading);
        }
      }
    },
    [onLoadingStateChange]
  );

  const isLoading = Array.from(loadingStates.current.values()).some(Boolean);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all timers
      debounceTimers.current.forEach((timer) => clearTimeout(timer));
      debounceTimers.current.clear();
      
      // Clear all maps
      observedElements.current.clear();
      loadingStates.current.clear();
      previousSizes.current.clear();
    };
  }, []);

  return {
    embedRef,
    registerEmbed,
    unregisterEmbed,
    setLoading,
    isLoading,
  };
};
