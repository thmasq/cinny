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
        // Clean up any object URLs we created
        if (processedTweetData.author?.avatar_url?.startsWith('blob:')) {
          URL.revokeObjectURL(processedTweetData.author.avatar_url);
        }
        if (processedTweetData.quote?.author?.avatar_url?.startsWith('blob:')) {
          URL.revokeObjectURL(processedTweetData.quote.author.avatar_url);
        }
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

        try {
          if (tweet.quote?.author?.avatar_url) {
            const res = await fetchProxied(tweet.quote.author.avatar_url, {
              signal: controller.signal,
            });
            const blob = await res.blob();
            processedData.quote.author.avatar_url = URL.createObjectURL(blob);
          }
        } catch (e) {
          console.warn('Failed to proxy fetch quote avatar:', e);
          processedData.quote.author.avatar_url = tweet.quote?.author?.avatar_url;
        }

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

  const renderQuoteTweet = () => {
    const { quote } = tweet;
    if (!quote) return null;

    return (
      <Box
        style={{
          marginLeft: config.space.S400,
          marginRight: config.space.S400,
          marginBottom: config.space.S300,
          padding: config.space.S300,
          backgroundColor: color.SurfaceVariant.Container,
          borderRadius: config.radii.R300,
          borderLeft: `3px solid ${color.Primary.Main}`,
        }}
      >
        <Box direction="Row" alignItems="Center" style={{ marginBottom: config.space.S200 }}>
          {quote.author.avatar_url && (
            <img
              src={quote.author.avatar_url}
              alt={`${quote.author.name} avatar`}
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                marginRight: config.space.S200,
              }}
            />
          )}
          <Text size="T200" style={{ fontWeight: 'bold' }}>
            {quote.author.name}
          </Text>
          <Text
            size="T200"
            style={{ color: color.Surface.OnContainer, marginLeft: config.space.S100 }}
          >
            @{quote.author.screen_name}
          </Text>
        </Box>
        <Text size="T200" style={{ lineHeight: '1.4' }}>
          {quote.text}
        </Text>
      </Box>
    );
  };

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

        {/* Tweet Text - Section 2 */}
        <Box
          style={{
            paddingLeft: config.space.S400,
            paddingRight: config.space.S400,
            marginBottom: config.space.S300,
            width: '100%',
          }}
        >
          <Text
            size="T300"
            style={{
              lineHeight: '1.4',
              whiteSpace: 'pre-wrap',
              display: 'block',
              width: '100%',
            }}
          >
            {tweet.text}
          </Text>
        </Box>

        {/* Quote Tweet - Section 3 (if exists) */}
        {tweetData.quote && renderQuoteTweet()}

        {/* Media Section - Section 4 */}
        {tweetData.media?.photos && tweetData.media.photos.length > 0 && (
          <Box style={{ width: '100%', marginBottom: config.space.S100 }}>
            {tweetData.media.photos.length === 1 ? (
              <img
                src={tweet.media.photos[0].url}
                alt="Tweet image"
                onClick={() => handleImageClick(tweet.media.photos[0].url, 'Tweet image')}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '400px',
                  objectFit: 'cover',
                  display: 'block',
                  cursor: 'pointer',
                  transition: 'transform 150ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            ) : (
              <Box
                style={{
                  display: 'grid',
                  gap: '2px',
                  marginLeft: config.space.S400,
                  marginRight: config.space.S400,
                  gridTemplateColumns:
                    tweetData.media.photos.length === 2
                      ? '1fr 1fr'
                      : tweetData.media.photos.length === 3
                      ? '1fr 1fr 1fr'
                      : '1fr 1fr',
                  gridTemplateRows: tweet.media.photos.length === 4 ? '1fr 1fr' : '1fr',
                }}
              >
                {tweet.media.photos.map((photo: any, index: number) => (
                  <img
                    key={index}
                    src={photo.url}
                    alt={`Tweet image ${index + 1}`}
                    onClick={() => handleImageClick(photo.url, `Tweet image ${index + 1}`)}
                    style={{
                      width: '100%',
                      height: '150px',
                      objectFit: 'cover',
                      cursor: 'pointer',
                      transition: 'transform 150ms ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}

        {/* Videos Section */}
        {tweet.media?.videos && tweet.media.videos.length > 0 && (
          <Box style={{ width: '100%', marginBottom: config.space.S300 }}>
            {tweet.media.videos.map((video: any, index: number) => (
              <video
                key={index}
                controls={video.type === 'video'}
                autoPlay={video.type === 'gif'}
                loop={video.type === 'gif'}
                muted={video.type === 'gif'}
                poster={video.thumbnail_url}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '400px',
                }}
              >
                <source src={video.url} type={video.format} />
                Your browser does not support the video tag.
              </video>
            ))}
          </Box>
        )}

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
