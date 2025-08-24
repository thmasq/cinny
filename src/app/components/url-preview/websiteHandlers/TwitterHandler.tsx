import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Button, Text, config, color } from 'folds';
import { WebsiteHandler, WebsiteHandlerResult } from './types';
import * as css from '../UrlPreview.css';
import { fetchProxied } from './utils';

// Twitter/X URL patterns
const TWITTER_PATTERNS = [
  /^https?:\/\/(?:www\.)?twitter\.com\/[^\/]+\/status\/\d+/,
  /^https?:\/\/(?:www\.)?x\.com\/[^\/]+\/status\/\d+/,
];

const extractTweetInfo = (url: string): { username: string; tweetId: string } | null => {
  const match = url.match(/^https?:\/\/(?:www\.)?(twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/);
  if (match) {
    return {
      username: match[2],
      tweetId: match[3],
    };
  }
  return null;
};

const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};

interface ImageOverlayProps {
  src: string;
  alt: string;
  onClose: () => void;
}

const ImageOverlay: React.FC<ImageOverlayProps> = ({ src, alt, onClose }) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [canZoom, setCanZoom] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleOverlayClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === overlayRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;

    const maxConstrainedWidth = window.innerWidth * 0.8;
    const maxConstrainedHeight = window.innerHeight * 0.8;

    const wouldZoomEnlarge =
      img.naturalWidth > maxConstrainedWidth || img.naturalHeight > maxConstrainedHeight;

    setCanZoom(wouldZoomEnlarge);
  }, []);

  const handleImageClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (canZoom) {
        setIsZoomed((prev) => !prev);
      }
    },
    [canZoom]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className={css.ImageOverlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div className={css.ImageOverlayContent}>
        <img
          ref={imageRef}
          className={isZoomed ? css.ImageOverlayImgZoomed : css.ImageOverlayImg}
          src={src}
          alt={alt}
          onLoad={handleImageLoad}
          onClick={handleImageClick}
          style={{
            cursor: canZoom ? 'pointer' : 'default',
          }}
        />
      </div>
    </div>
  );
};

interface TwitterEmbedProps {
  url: string;
  ts: number;
}

const TwitterEmbed: React.FC<TwitterEmbedProps> = ({ url }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tweetData, setTweetData] = useState<any>(null);
  const [processedTweetData, setProcessedTweetData] = useState<any>(null);
  const [overlayImage, setOverlayImage] = useState<{ src: string; alt: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (processedTweetData) {
        // Clean up main tweet URLs
        if (processedTweetData.author?.avatar_url?.startsWith('blob:')) {
          URL.revokeObjectURL(processedTweetData.author.avatar_url);
        }
        
        // Clean up main tweet media
        processedTweetData.media?.photos?.forEach((photo: any) => {
          if (photo.url.startsWith('blob:')) {
            URL.revokeObjectURL(photo.url);
          }
        });
        processedTweetData.media?.videos?.forEach((video: any) => {
          if (video.url.startsWith('blob:')) {
            URL.revokeObjectURL(video.url);
          }
          if (video.thumbnail_url?.startsWith('blob:')) {
            URL.revokeObjectURL(video.thumbnail_url);
          }
        });

        // Clean up quote tweet URLs
        if (processedTweetData.quote?.author?.avatar_url?.startsWith('blob:')) {
          URL.revokeObjectURL(processedTweetData.quote.author.avatar_url);
        }

        // Clean up quote tweet media
        processedTweetData.quote?.media?.photos?.forEach((photo: any) => {
          if (photo.url.startsWith('blob:')) {
            URL.revokeObjectURL(photo.url);
          }
        });
        processedTweetData.quote?.media?.videos?.forEach((video: any) => {
          if (video.url.startsWith('blob:')) {
            URL.revokeObjectURL(video.url);
          }
          if (video.thumbnail_url?.startsWith('blob:')) {
            URL.revokeObjectURL(video.thumbnail_url);
          }
        });
      }
    };
  }, [processedTweetData]);

  const handleImageClick = useCallback((src: string, alt: string) => {
    setOverlayImage({ src, alt });
  }, []);

  const handleCloseOverlay = useCallback(() => {
    setOverlayImage(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      setError('Request timeout');
      setLoading(false);
    }, 10000);

    const fetchAndProcessTweet = async () => {
      const tweetInfo = extractTweetInfo(url);

      if (!tweetInfo) {
        setError('Invalid Twitter URL');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const apiUrl = `https://api.fxtwitter.com/${tweetInfo.username}/status/${tweetInfo.tweetId}`;
        const response = await fetch(apiUrl, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.code !== 200) {
          throw new Error(data.message || 'Failed to fetch tweet');
        }

        const tweet = data.tweet;
        setTweetData(tweet);

        const processedData = { ...tweet };

        // Process main tweet author avatar
        try {
          if (tweet.author?.avatar_url) {
            const res = await fetchProxied(tweet.author.avatar_url, { signal: controller.signal });
            const blob = await res.blob();
            processedData.author.avatar_url = URL.createObjectURL(blob);
          }
        } catch (e) {
          console.warn('Failed to proxy fetch author avatar:', e);
          processedData.author.avatar_url = tweet.author?.avatar_url;
        }

        // Process quote tweet data if it exists
        if (tweet.quote) {
          processedData.quote = { ...tweet.quote };
          
          // Process quote tweet author avatar
          try {
            if (tweet.quote.author?.avatar_url) {
              const res = await fetchProxied(tweet.quote.author.avatar_url, {
                signal: controller.signal,
              });
              const blob = await res.blob();
              processedData.quote.author.avatar_url = URL.createObjectURL(blob);
            }
          } catch (e) {
            console.warn('Failed to proxy fetch quote author avatar:', e);
            processedData.quote.author.avatar_url = tweet.quote.author?.avatar_url;
          }

          // Process quote tweet photos
          if (tweet.quote.media?.photos) {
            processedData.quote.media = { ...tweet.quote.media };
            processedData.quote.media.photos = [...tweet.quote.media.photos];
            
            for (let i = 0; i < tweet.quote.media.photos.length; i++) {
              try {
                const res = await fetchProxied(tweet.quote.media.photos[i].url, {
                  signal: controller.signal,
                });
                const blob = await res.blob();
                processedData.quote.media.photos[i] = {
                  ...processedData.quote.media.photos[i],
                  url: URL.createObjectURL(blob),
                };
              } catch (e) {
                console.warn('Failed to proxy fetch quote photo:', tweet.quote.media.photos[i].url, e);
                // Keep original URL as fallback
              }
            }
          }

          // Process quote tweet videos
          if (tweet.quote.media?.videos) {
            if (!processedData.quote.media) {
              processedData.quote.media = { ...tweet.quote.media };
            }
            processedData.quote.media.videos = [...tweet.quote.media.videos];
            
            for (let i = 0; i < tweet.quote.media.videos.length; i++) {
              const video = tweet.quote.media.videos[i];
              try {
                if (video.thumbnail_url) {
                  const thumbRes = await fetchProxied(video.thumbnail_url, {
                    signal: controller.signal,
                  });
                  const thumbBlob = await thumbRes.blob();
                  processedData.quote.media.videos[i] = {
                    ...processedData.quote.media.videos[i],
                    thumbnail_url: URL.createObjectURL(thumbBlob),
                  };
                }

                const videoRes = await fetchProxied(video.url, { signal: controller.signal });
                const videoBlob = await videoRes.blob();
                processedData.quote.media.videos[i] = {
                  ...processedData.quote.media.videos[i],
                  url: URL.createObjectURL(videoBlob),
                };
              } catch (e) {
                console.warn('Failed to proxy fetch quote video:', video.url, e);
                // Keep original URLs as fallback
              }
            }
          }
        }

        // Process main tweet photos
        if (tweet.media?.photos) {
          for (let i = 0; i < tweet.media.photos.length; i++) {
            try {
              const res = await fetchProxied(tweet.media.photos[i].url, {
                signal: controller.signal,
              });
              const blob = await res.blob();
              processedData.media.photos[i].url = URL.createObjectURL(blob);
            } catch (e) {
              console.warn('Failed to proxy fetch photo:', tweet.media.photos[i].url, e);
              processedData.media.photos[i].url = tweet.media.photos[i].url;
            }
          }
        }

        // Process main tweet videos
        if (tweet.media?.videos) {
          for (let i = 0; i < tweet.media.videos.length; i++) {
            const video = tweet.media.videos[i];
            try {
              if (video.thumbnail_url) {
                const thumbRes = await fetchProxied(video.thumbnail_url, {
                  signal: controller.signal,
                });
                const thumbBlob = await thumbRes.blob();
                processedData.media.videos[i].thumbnail_url = URL.createObjectURL(thumbBlob);
              }

              const videoRes = await fetchProxied(video.url, { signal: controller.signal });
              const videoBlob = await videoRes.blob();
              processedData.media.videos[i].url = URL.createObjectURL(videoBlob);
            } catch (e) {
              console.warn('Failed to proxy fetch video:', video.url, e);
              processedData.media.videos[i].url = video.url;
              processedData.media.videos[i].thumbnail_url = video.thumbnail_url;
            }
          }
        }

        setProcessedTweetData(processedData);
        setLoading(false);
        clearTimeout(timeoutId);

        if (containerRef.current) {
          const event = new CustomEvent('embedLoaded', { detail: { success: true } });
          containerRef.current.dispatchEvent(event);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.error('TwitterEmbed: Request timeout:', err);
          setError('Request timed out');
        } else {
          console.error('TwitterEmbed: Error processing tweet:', err);
          setError(err instanceof Error ? err.message : 'Failed to load tweet');
        }
        setLoading(false);

        if (containerRef.current) {
          const event = new CustomEvent('embedLoaded', { detail: { success: false, error: err } });
          containerRef.current.dispatchEvent(event);
        }
      }
    };

    fetchAndProcessTweet();

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [url]);

  const renderMediaGrid = useCallback(
    (photos: any[], isQuote = false) => {
      if (!photos || photos.length === 0) return null;

      const imageStyle = {
        width: '100%',
        height: photos.length === 1 ? 'auto' : '150px',
        maxHeight: photos.length === 1 ? '400px' : '150px',
        objectFit: 'cover' as const,
        cursor: 'pointer',
        transition: 'transform 150ms ease',
        borderRadius: isQuote ? config.radii.R200 : '0',
      };

      const containerStyle = isQuote
        ? {
            marginTop: config.space.S200,
            borderRadius: config.radii.R200,
            overflow: 'hidden',
          }
        : {
            width: '100%',
            marginBottom: config.space.S100,
          };

      if (photos.length === 1) {
        return (
          <Box style={containerStyle}>
            <img
              src={photos[0].url}
              alt={isQuote ? 'Quote tweet image' : 'Tweet image'}
              onClick={() =>
                handleImageClick(photos[0].url, isQuote ? 'Quote tweet image' : 'Tweet image')
              }
              style={imageStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            />
          </Box>
        );
      }

      const gridStyle = {
        display: 'grid',
        gap: '2px',
        ...(isQuote
          ? {}
          : {
              marginLeft: config.space.S400,
              marginRight: config.space.S400,
            }),
        gridTemplateColumns:
          photos.length === 2
            ? '1fr 1fr'
            : photos.length === 3
            ? '1fr 1fr 1fr'
            : '1fr 1fr',
        gridTemplateRows: photos.length === 4 ? '1fr 1fr' : '1fr',
      };

      return (
        <Box style={{ ...containerStyle }}>
          <Box style={gridStyle}>
            {photos.map((photo: any, index: number) => (
              <img
                key={index}
                src={photo.url}
                alt={`${isQuote ? 'Quote tweet' : 'Tweet'} image ${index + 1}`}
                onClick={() =>
                  handleImageClick(
                    photo.url,
                    `${isQuote ? 'Quote tweet' : 'Tweet'} image ${index + 1}`
                  )
                }
                style={imageStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            ))}
          </Box>
        </Box>
      );
    },
    [handleImageClick]
  );

  const renderVideoGrid = useCallback((videos: any[], isQuote = false) => {
    if (!videos || videos.length === 0) return null;

    const containerStyle = isQuote
      ? {
          marginTop: config.space.S200,
          borderRadius: config.radii.R200,
          overflow: 'hidden',
        }
      : {
          width: '100%',
          marginBottom: config.space.S300,
        };

    const videoStyle = {
      width: '100%',
      height: 'auto',
      maxHeight: '400px',
      borderRadius: isQuote ? config.radii.R200 : '0',
    };

    return (
      <Box style={containerStyle}>
        {videos.map((video: any, index: number) => (
          <video
            key={index}
            controls={video.type === 'video'}
            autoPlay={video.type === 'gif'}
            loop={video.type === 'gif'}
            muted={video.type === 'gif'}
            poster={video.thumbnail_url}
            style={videoStyle}
          >
            <source src={video.url} type={video.format} />
            Your browser does not support the video tag.
          </video>
        ))}
      </Box>
    );
  }, []);

  const renderQuoteTweet = () => {
    const { quote } = processedTweetData;
    if (!quote) return null;

    return (
      <Box
        direction="Column"
        style={{
          marginLeft: config.space.S400,
          marginRight: config.space.S400,
          marginBottom: config.space.S300,
          padding: config.space.S300,
          backgroundColor: color.SurfaceVariant.Container,
          borderRadius: config.radii.R300,
          border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
          gap: config.space.S200,
        }}
      >
        {/* Quote tweet author header */}
        <Box direction="Row" alignItems="Center" gap="200">
          {quote.author.avatar_url && (
            <img
              src={quote.author.avatar_url}
              alt={`${quote.author.name} avatar`}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                flexShrink: 0,
              }}
            />
          )}
          <Text size="T200" style={{ fontWeight: 600, lineHeight: '1.2' }}>
            {quote.author.name}
          </Text>
          <Text
            size="T200"
            style={{ color: color.Surface.OnContainer, opacity: 0.6 }}
          >
            @{quote.author.screen_name}
          </Text>
        </Box>

        {/* Quote tweet text with proper line wrapping */}
        {quote.text && (
          <Text 
            size="T200" 
            style={{ 
              lineHeight: '1.4',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
              hyphens: 'auto',
              width: '100%',
              minWidth: 0,
            }}
          >
            {quote.text}
          </Text>
        )}

        {/* Quote tweet media */}
        {quote.media?.photos && renderMediaGrid(quote.media.photos, true)}
        {quote.media?.videos && renderVideoGrid(quote.media.videos, true)}
      </Box>
    );
  };

  if (loading) {
    return (
      <Box
        ref={containerRef}
        className={css.UrlPreview}
        direction="Column"
        alignItems="Center"
        justifyContent="Center"
        style={{
          borderRadius: config.radii.R300,
          backgroundColor: color.Surface.Container,
          maxWidth: '500px',
          minHeight: '150px',
          padding: config.space.S400,
        }}
        data-embed-container
        data-twitter-embed
      >
        <Box direction="Column" alignItems="Center" gap="300">
          <div
            style={{
              width: '24px',
              height: '24px',
              border: '2px solid transparent',
              borderTop: `2px solid ${color.Primary.Main}`,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          <Text size="T300" align="Center" style={{ opacity: 0.7 }}>
            Loading tweet...
          </Text>
        </Box>
      </Box>
    );
  }

  if (error || !processedTweetData) {
    return (
      <Box
        ref={containerRef}
        className={css.UrlPreview}
        direction="Column"
        alignItems="Center"
        justifyContent="Center"
        style={{
          borderRadius: config.radii.R300,
          backgroundColor: color.Surface.Container,
          maxWidth: '500px',
          minHeight: '120px',
          padding: config.space.S400,
        }}
        data-embed-container
        data-twitter-embed
      >
        <Text size="T300" align="Center" style={{ color: color.Critical.Main }}>
          Failed to load tweet
        </Text>
        {error && (
          <Text size="T200" align="Center" style={{ opacity: 0.7, marginTop: config.space.S200 }}>
            {error}
          </Text>
        )}
      </Box>
    );
  }

  const tweet = processedTweetData;

  return (
    <>
      <Box
        ref={containerRef}
        className={css.UrlPreview}
        direction="Column"
        style={{
          borderRadius: config.radii.R300,
          backgroundColor: color.Surface.Container,
          maxWidth: '500px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 0.3s ease',
        }}
        data-embed-container
        data-twitter-embed
      >
        {/* Author Header - Section 1 */}
        <Box
          direction="Row"
          alignItems="Center"
          gap="300"
          style={{
            paddingTop: config.space.S400,
            paddingLeft: config.space.S400,
            paddingRight: config.space.S400,
            paddingBottom: config.space.S100,
            width: '100%',
            display: 'flex',
          }}
        >
          {tweet.author?.avatar_url && (
            <img
              src={tweet.author.avatar_url}
              alt={`${tweet.author.name} avatar`}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                marginRight: config.space.S300,
                flexShrink: 0,
              }}
            />
          )}
          <Box direction="Column">
            <Text size="T300" style={{ fontWeight: 'bold', lineHeight: '1.2' }}>
              {tweet.author?.name || 'Unknown User'}
            </Text>
            <Text size="T200" style={{ color: color.Surface.OnContainer, opacity: 0.7 }}>
              @{tweet.author?.screen_name || 'unknown'}
            </Text>
          </Box>
        </Box>

        {/* Tweet Text - Section 2 with improved line wrapping */}
        {tweet.text && (
          <Box
            style={{
              paddingLeft: config.space.S400,
              paddingRight: config.space.S400,
              marginBottom: config.space.S300,
              width: '100%',
              minWidth: 0,
            }}
          >
            <Text
              size="T300"
              style={{
                lineHeight: '1.4',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
                hyphens: 'auto',
                display: 'block',
                width: '100%',
                minWidth: 0,
              }}
            >
              {tweet.text}
            </Text>
          </Box>
        )}

        {/* Quote Tweet - Section 3 (if exists) */}
        {tweet.quote && renderQuoteTweet()}

        {/* Main Tweet Media Section - Section 4 */}
        {tweet.media?.photos && renderMediaGrid(tweet.media.photos, false)}
        {tweet.media?.videos && renderVideoGrid(tweet.media.videos, false)}

        {/* Stats Section - Section 5 */}
        <Box
          direction="Row"
          alignItems="Center"
          gap="400"
          style={{
            paddingTop: config.space.S100,
            paddingLeft: config.space.S400,
            paddingRight: config.space.S400,
            paddingBottom: config.space.S200,
            width: '100%',
            display: 'flex',
          }}
        >
          <Text size="T200" style={{ color: color.Surface.OnContainer }}>
            🔁 {formatNumber(tweet.retweets || 0)}
          </Text>
          <Text size="T200" style={{ color: color.Surface.OnContainer }}>
            ❤️ {formatNumber(tweet.likes || 0)}
          </Text>
          {tweetData.views && (
            <Text size="T200" style={{ color: color.Surface.OnContainer }}>
              👁️ {formatNumber(tweetData.views)}
            </Text>
          )}
        </Box>
      </Box>

      {/* Image Overlay Modal */}
      {overlayImage && (
        <ImageOverlay src={overlayImage.src} alt={overlayImage.alt} onClose={handleCloseOverlay} />
      )}

      {/* Add spinning animation styles */}
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};

export const twitterHandler: WebsiteHandler = {
  name: 'Twitter',
  test: (url: string) => {
    try {
      return TWITTER_PATTERNS.some((pattern) => pattern.test(url));
    } catch (error) {
      console.warn('Error testing Twitter URL pattern:', error);
      return null;
    }
  },
  handle: (url: string): WebsiteHandlerResult | null => {
    try {
      const tweetInfo = extractTweetInfo(url);
      if (!tweetInfo) return null;

      return {
        type: 'embed',
        component: TwitterEmbed,
        shouldReplace: true,
        metadata: {
          title: 'Tweet',
          siteName: 'Twitter',
          handlerName: 'Twitter',
        },
      };
    } catch (error) {
      console.warn('Error handling Twitter URL:', url, error);
      return null;
    }
  },
};
