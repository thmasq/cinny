import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Button, Icon, Icons, Text, config, color } from 'folds';
import { WebsiteHandler, WebsiteHandlerResult } from './types';
import * as css from '../UrlPreview.css';

const YOUTUBE_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)(?:&.*)?$/,
  /^https?:\/\/(www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]+)(?:\?.*)?$/,
  /^https?:\/\/()?youtu\.be\/([a-zA-Z0-9_-]+)(?:\?.*)?$/,
  /^https?:\/\/(www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]+)(?:\?.*)?$/,
];

const extractVideoId = (url: string): string | null => {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return match[2];
    }
  }
  return null;
};

interface YouTubeEmbedProps {
  url: string;
  ts: number;
}

const YouTubeEmbed: React.FC<YouTubeEmbedProps> = ({ url }) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 560, height: 315 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const videoId = extractVideoId(url);

  const handleError = useCallback(() => {
    console.warn('YouTube embed failed to load:', url);
    setHasError(true);
    setIsLoading(false);
  }, [url]);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
    
    // Notify parent about size change after load
    if (containerRef.current) {
      const event = new CustomEvent('embedResize', {
        detail: {
          width: dimensions.width,
          height: dimensions.height,
        },
      });
      containerRef.current.dispatchEvent(event);
    }
  }, [dimensions]);

  const handleRetry = useCallback(() => {
    if (retryCount < 3) {
      setHasError(false);
      setIsLoading(true);
      setRetryCount((prev) => prev + 1);
    }
  }, [retryCount]);

  // Calculate responsive dimensions
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth || 560;
        const maxWidth = Math.min(containerWidth, 560); // Max 560px width
        const aspectRatio = 16 / 9; // YouTube aspect ratio
        const height = Math.round(maxWidth / aspectRatio);
        
        setDimensions({
          width: maxWidth,
          height: Math.max(height, 315), // Min 315px height
        });
      }
    };

    updateDimensions();
    
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    setHasError(false);
    setIsLoading(true);
    setRetryCount(0);
  }, [url]);

  if (!videoId) {
    return (
      <Box
        className={css.UrlPreview}
        direction="Column"
        alignItems="Center"
        justifyContent="Center"
        style={{
          minHeight: '200px',
          backgroundColor: color.Surface.Container,
          borderRadius: config.radii.R300,
          padding: config.space.S400,
        }}
      >
        <Icon src={Icons.Warning} size="600" />
        <Text size="T300" align="Center">
          Invalid YouTube URL
        </Text>
      </Box>
    );
  }

  if (hasError) {
    return (
      <Box
        className={css.UrlPreview}
        direction="Column"
        alignItems="Center"
        justifyContent="Center"
        style={{
          minHeight: '200px',
          backgroundColor: color.Surface.Container,
          borderRadius: config.radii.R300,
          padding: config.space.S400,
          gap: config.space.S300,
        }}
      >
        <Icon src={Icons.Warning} size="600" />
        <Text size="T300" align="Center">
          Failed to load YouTube video
        </Text>
        {retryCount < 3 && (
          <Button variant="Secondary" size="300" onClick={handleRetry}>
            <Text size="T200">Retry</Text>
          </Button>
        )}
      </Box>
    );
  }

  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&rel=0&modestbranding=1`;

  return (
    <Box
      ref={containerRef}
      className={css.UrlPreview}
      style={{
        borderRadius: config.radii.R300,
        overflow: 'hidden',
        width: 'fit-content',
        maxWidth: '100%',
        position: 'relative',
        minHeight: isLoading ? '315px' : undefined,
        backgroundColor: isLoading ? color.Surface.Container : 'transparent',
        transition: 'all 0.3s ease',
      }}
      data-embed-container
      data-youtube-embed
    >
      {isLoading && (
        <Box
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: color.Surface.Container,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
            borderRadius: config.radii.R300,
          }}
        >
          <Box direction="Column" alignItems="Center" gap="300">
            <Icon src={Icons.Play} size="600" />
            <Text size="T300" align="Center" style={{ opacity: 0.7 }}>
              Loading YouTube video...
            </Text>
          </Box>
        </Box>
      )}

      <iframe
        ref={iframeRef}
        key={`${videoId}-${retryCount}`}
        src={embedUrl}
        title="YouTube video player"
        width={dimensions.width}
        height={dimensions.height}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        style={{
          maxWidth: '100%',
          border: 'none',
          display: 'block',
          opacity: isLoading ? 0 : 1,
          transition: 'opacity 0.3s ease',
        }}
        onError={handleError}
        onLoad={handleLoad}
      />
    </Box>
  );
};

export const youtubeHandler: WebsiteHandler = {
  name: 'YouTube',
  test: (url: string) => {
    try {
      return YOUTUBE_PATTERNS.some((pattern) => pattern.test(url));
    } catch (error) {
      console.warn('Error testing YouTube URL pattern:', error);
      return false;
    }
  },
  handle: (url: string): WebsiteHandlerResult | null => {
    try {
      const videoId = extractVideoId(url);
      if (!videoId) return null;

      return {
        type: 'embed',
        component: YouTubeEmbed,
        shouldReplace: true,
        metadata: {
          title: 'YouTube Video',
          siteName: 'YouTube',
          handlerName: 'YouTube',
        },
      };
    } catch (error) {
      console.warn('Error handling YouTube URL:', url, error);
      return null;
    }
  },
};
