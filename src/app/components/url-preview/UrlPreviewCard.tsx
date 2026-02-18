import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IPreviewUrlResponse } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Scroll, Spinner, as, config } from 'folds';
import { AsyncStatus, AsyncState } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  UrlPreview,
  UrlPreviewContent,
  UrlPreviewDescription,
  UrlPreviewImage,
  UrlPreviewLink,
  UrlPreviewSiteName,
  UrlPreviewTitle,
} from './UrlPreview';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { tryDecodeURIComponent } from '../../utils/dom';
import { mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { websiteHandlerRegistry } from './websiteHandlers/registry';
import { useEmbedResizeHandler } from '../../hooks/useEmbedResizeHandler';
import * as css from './UrlPreviewCard.css';

const MAX_THUMBNAIL_SIZE = 600;

interface PreviewState {
  regular: AsyncState<IPreviewUrlResponse, unknown>;
  handlerResult: any | null;
  handlerError: Error | null;
}

export const UrlPreviewCard = as<'div', { url: string; ts: number }>(
  ({ url, ts, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [websiteHandlersEnabled] = useSetting(settingsAtom, 'websiteHandlers');

    // Unified state management for both preview types
    const [previewState, setPreviewState] = useState<PreviewState>({
      regular: { status: AsyncStatus.Idle },
      handlerResult: null,
      handlerError: null,
    });

    // Loading state for embeds
    const [isEmbedLoading, setIsEmbedLoading] = useState(false);
    const [embedLoadError, setEmbedLoadError] = useState<string | null>(null);

    // Embed resize handler
    const embedResizeHandler = useEmbedResizeHandler({
      onEmbedResize: useCallback((element, size) => {
        // Optional: Log resize events for debugging
        // console.log('Embed resized:', element, size);
      }, []),
      onLoadingStateChange: useCallback((loading) => {
        setIsEmbedLoading(loading);
      }, []),
      debounceMs: 150, // Slightly higher debounce for smoother experience
    });

    // Memoize website handler to prevent unnecessary re-computation
    const websiteHandler = useMemo(() => {
      if (!websiteHandlersEnabled) return null;
      return websiteHandlerRegistry.getHandler(url);
    }, [url, websiteHandlersEnabled]);

    // Memoize handler result to prevent double computation
    const handlerResult = useMemo(() => {
      if (!websiteHandler) return null;
      try {
        setEmbedLoadError(null);
        return websiteHandler.handle(url);
      } catch (error) {
        console.warn('Website handler failed for URL:', url, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setEmbedLoadError(errorMessage);
        setPreviewState((prev) => ({ ...prev, handlerError: error as Error }));
        return null;
      }
    }, [websiteHandler, url]);

    const loadPreviewSafely = useCallback(async () => {
      setPreviewState((prev) => ({
        ...prev,
        regular: { status: AsyncStatus.Loading },
      }));

      try {
        const data = await mx.getUrlPreview(url, ts);
        setPreviewState((prev) => ({
          ...prev,
          regular: {
            status: AsyncStatus.Success,
            data,
          },
        }));
      } catch (error) {
        console.warn('Failed to load URL preview for:', url, error);

        if (error instanceof TypeError && error.message.includes('NetworkError')) {
          console.warn(
            'Network error occurred while fetching URL preview. The URL might be invalid or unreachable:',
            url
          );
        }

        setPreviewState((prev) => ({
          ...prev,
          regular: {
            status: AsyncStatus.Error,
            error,
          },
        }));
      }
    }, [mx, url, ts]);

    const prevUrlRef = useRef<string | null>(null);
    const prevTsRef = useRef<number | null>(null);
    const loadedParamsRef = useRef<{ url: string; ts: number } | null>(null);

    useEffect(() => {
      const urlChanged = url !== prevUrlRef.current;

      if (urlChanged) {
        setPreviewState({
          regular: { status: AsyncStatus.Idle },
          handlerResult: null,
          handlerError: null,
        });
        setEmbedLoadError(null);
        setIsEmbedLoading(false);
      }
      
      prevUrlRef.current = url;
      prevTsRef.current = ts;

      // Determine if we need to load regular preview
      const needsRegularPreview = !handlerResult?.shouldReplace;

      const shouldLoad =
        needsRegularPreview &&
        (urlChanged ||
          loadedParamsRef.current?.url !== url);

      if (shouldLoad) {
        loadPreviewSafely();
        loadedParamsRef.current = { url, ts };
      }
    }, [url, ts, handlerResult?.shouldReplace, loadPreviewSafely]);

    const previewData =
      previewState.regular.status === AsyncStatus.Success ? previewState.regular.data : null;
    const ogImage = previewData?.['og:image'];
    const ogImageWidth = previewData ? Number(previewData['og:image:width']) || null : null;
    const ogImageHeight = previewData ? Number(previewData['og:image:height']) || null : null;
    const siteName = previewData?.['og:site_name'];
    const title = previewData?.['og:title'];
    const description = previewData?.['og:description'];

    // Calculate aspect ratio - always compute this
    const aspectRatio = useMemo(() => {
      if (ogImageWidth && ogImageHeight) {
        return ogImageWidth / ogImageHeight;
      }
      return null;
    }, [ogImageWidth, ogImageHeight]);

    // Generate image URLs - always compute this
    const { thumbnailUrl, fullImageUrl } = useMemo(() => {
      if (!ogImage) return { thumbnailUrl: null, fullImageUrl: null };

      // Extract MXC ID from the og:image URL
      const mxcMatch = ogImage.match(/^mxc:\/\/([^\/]+)\/(.+)$/);
      if (!mxcMatch) {
        // If not MXC URL, use as-is
        return { thumbnailUrl: ogImage, fullImageUrl: ogImage };
      }

      const [, serverName, mediaId] = mxcMatch;
      const baseUrl = mx.getHomeserverUrl();

      // Create thumbnail URL (max 600x600)
      let thumbnailWidth = MAX_THUMBNAIL_SIZE;
      let thumbnailHeight = MAX_THUMBNAIL_SIZE;

      // Calculate optimal thumbnail dimensions while maintaining aspect ratio
      if (aspectRatio) {
        if (aspectRatio > 1) {
          // Landscape: limit width, calculate height
          thumbnailHeight = Math.min(
            MAX_THUMBNAIL_SIZE,
            Math.round(MAX_THUMBNAIL_SIZE / aspectRatio)
          );
        } else {
          // Portrait: limit height, calculate width
          thumbnailWidth = Math.min(
            MAX_THUMBNAIL_SIZE,
            Math.round(MAX_THUMBNAIL_SIZE * aspectRatio)
          );
        }
      }

      const thumbnailUrl = `${baseUrl}/_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}?width=${thumbnailWidth}&height=${thumbnailHeight}&method=scale`;
      const fullImageUrl = `${baseUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`;

      return { thumbnailUrl, fullImageUrl };
    }, [ogImage, aspectRatio, mx]);

    const renderRegularContent = useCallback(
      () => (
        <>
          {thumbnailUrl && (
            <UrlPreviewImage
              src={thumbnailUrl}
              fullSrc={fullImageUrl || undefined}
              alt={title || 'Preview image'}
              title={title || undefined}
              aspectRatio={aspectRatio || undefined}
            />
          )}
          <UrlPreviewContent>
            {siteName && <UrlPreviewSiteName>{siteName}</UrlPreviewSiteName>}

            {title && <UrlPreviewTitle>{title}</UrlPreviewTitle>}

            {description && <UrlPreviewDescription>{description}</UrlPreviewDescription>}

            <UrlPreviewLink href={url} target="_blank" rel="noopener noreferrer" title={url}>
              {tryDecodeURIComponent(url)}
            </UrlPreviewLink>
          </UrlPreviewContent>
        </>
      ),
      [thumbnailUrl, fullImageUrl, title, aspectRatio, siteName, description, url]
    );

    // Enhanced loading state component
    const LoadingPlaceholder = useCallback(
      ({ minHeight = 102 }: { minHeight?: number }) => (
        <Box 
          alignItems="Center" 
          justifyContent="Center" 
          style={{ 
            minHeight: `${minHeight}px`,
            opacity: 0.7,
            transition: 'opacity 0.3s ease'
          }}
        >
          <Spinner variant="Secondary" size="600" />
        </Box>
      ),
      []
    );

    // Error state component
    const ErrorPlaceholder = useCallback(
      ({ message }: { message: string }) => (
        <Box 
          alignItems="Center" 
          justifyContent="Center" 
          style={{ 
            minHeight: '80px',
            padding: config.space.S300,
            color: 'var(--color-surface-oncontainer)',
            opacity: 0.6
          }}
        >
          <Box direction="Column" alignItems="Center" gap="200">
            <Icon src={Icons.Warning} size="300" />
            <Box style={{ fontSize: '0.75rem', textAlign: 'center' }}>
              {message}
            </Box>
          </Box>
        </Box>
      ),
      []
    );

    // Handle errors
    if (previewState.regular.status === AsyncStatus.Error && !handlerResult) {
      return null;
    }

    if (previewState.handlerError && handlerResult) {
      console.warn('Website handler component failed, falling back to regular preview');
    }

    if (embedLoadError && handlerResult?.shouldReplace) {
      return (
        <UrlPreview {...props} ref={ref} data-url-preview data-embed-container>
          <ErrorPlaceholder message={`Failed to load ${handlerResult.metadata?.siteName || 'embed'}`} />
        </UrlPreview>
      );
    }

    // Handler that completely replaces the preview
    if (handlerResult && handlerResult.shouldReplace && !previewState.handlerError) {
      const { component: HandlerComponent } = handlerResult;

      return (
        <UrlPreview 
          {...props} 
          ref={ref} 
          data-url-preview 
          data-embed-container 
          style={{ 
            transition: 'min-height 0.3s ease',
            minHeight: isEmbedLoading ? '120px' : undefined
          }}
        >
          <div ref={embedResizeHandler.embedRef}>
            <HandlerComponent url={url} ts={ts} />
            {isEmbedLoading && (
              <Box 
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(255, 255, 255, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1
                }}
              >
                <Spinner variant="Secondary" size="400" />
              </Box>
            )}
          </div>
        </UrlPreview>
      );
    }

    // Handler that supplements the regular preview
    if (handlerResult && !handlerResult.shouldReplace && !previewState.handlerError) {
      const { component: HandlerComponent } = handlerResult;

      return (
        <UrlPreview {...props} ref={ref} data-url-preview data-embed-container>
          <div ref={embedResizeHandler.embedRef}>
            <HandlerComponent url={url} ts={ts} />
          </div>
          {previewState.regular.status === AsyncStatus.Success && renderRegularContent()}
          {previewState.regular.status === AsyncStatus.Loading && (
            <LoadingPlaceholder minHeight={102} />
          )}
        </UrlPreview>
      );
    }

    // Regular preview only
    return (
      <UrlPreview 
        {...props} 
        ref={ref} 
        data-url-preview
        style={{
          minHeight: previewState.regular.status === AsyncStatus.Loading ? '102px' : undefined,
          transition: 'min-height 0.3s ease'
        }}
      >
        {previewState.regular.status === AsyncStatus.Success ? (
          renderRegularContent()
        ) : (
          <LoadingPlaceholder minHeight={102} />
        )}
      </UrlPreview>
    );
  }
);

export const UrlPreviewHolder = as<'div'>(({ children, ...props }, ref) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const backAnchorRef = useRef<HTMLDivElement>(null);
  const frontAnchorRef = useRef<HTMLDivElement>(null);
  const [backVisible, setBackVisible] = useState(true);
  const [frontVisible, setFrontVisible] = useState(true);

  const intersectionObserver = useIntersectionObserver(
    useCallback((entries) => {
      const backAnchor = backAnchorRef.current;
      const frontAnchor = frontAnchorRef.current;
      const backEntry = backAnchor && getIntersectionObserverEntry(backAnchor, entries);
      const frontEntry = frontAnchor && getIntersectionObserverEntry(frontAnchor, entries);
      if (backEntry) {
        setBackVisible(backEntry.isIntersecting);
      }
      if (frontEntry) {
        setFrontVisible(frontEntry.isIntersecting);
      }
    }, []),
    useCallback(
      () => ({
        root: scrollRef.current,
        rootMargin: '10px',
      }),
      []
    )
  );

  useEffect(() => {
    const scrollElement = scrollRef.current;
    const backAnchor = backAnchorRef.current;
    const frontAnchor = frontAnchorRef.current;
    if (!scrollElement || !backAnchor || !frontAnchor) return;

    intersectionObserver?.observe(backAnchor);
    intersectionObserver?.observe(frontAnchor);
    return () => {
      intersectionObserver?.unobserve(backAnchor);
      intersectionObserver?.unobserve(frontAnchor);
    };
  });

  const handleBackClick = () => {
    scrollRef.current?.scrollBy({
      left: -295,
      behavior: 'smooth',
    });
  };
  const handleFrontClick = () => {
    scrollRef.current?.scrollBy({
      left: 295,
      behavior: 'smooth',
    });
  };

  return (
    <Box {...props} ref={ref} direction="Column" gap="200">
      <Box position="Relative">
        {!backVisible && (
          <>
            <div className={css.UrlPreviewHolderGradient({ position: 'Left' })} />
            <IconButton
              className={css.UrlPreviewHolderBtn({ position: 'Left' })}
              variant="SurfaceVariant"
              size="300"
              radii="Pill"
              onClick={handleBackClick}
            >
              <Icon src={Icons.ChevronLeft} />
            </IconButton>
          </>
        )}
        {!frontVisible && (
          <>
            <div className={css.UrlPreviewHolderGradient({ position: 'Right' })} />
            <IconButton
              className={css.UrlPreviewHolderBtn({ position: 'Right' })}
              variant="SurfaceVariant"
              size="300"
              radii="Pill"
              onClick={handleFrontClick}
            >
              <Icon src={Icons.ChevronRight} />
            </IconButton>
          </>
        )}
        <Scroll ref={scrollRef} direction="Horizontal" hideTrack>
          <Box gap="200" direction="Row">
            <div ref={backAnchorRef} />
            {children}
            <div ref={frontAnchorRef} />
          </Box>
        </Scroll>
      </Box>
    </Box>
  );
});
