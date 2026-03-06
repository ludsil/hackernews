const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { logger } = require('./logger');

class S3ClientWrapper {
  constructor(region, accessKeyId, secretAccessKey, bucketName, endpoint) {
    this.bucketName = bucketName;

    const config = {
      region,
      endpoint,
      forcePathStyle: !!endpoint, // Required for MinIO / S3-compatible
    };

    // Use explicit credentials if provided, otherwise fall back to
    // the default AWS credential chain (IAM roles, instance profiles, etc.)
    if (accessKeyId && secretAccessKey) {
      config.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.client = new S3Client(config);

    logger.info('S3 client initialized', {
      bucketName,
      endpoint: endpoint || 'AWS S3'
    });
  }

  async uploadRawJson(hnId, data) {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const key = `raw/${date}/${hnId}.json`;

    try {
      logger.debug('Uploading raw JSON', { hnId, key });

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: JSON.stringify(data, null, 2),
          ContentType: 'application/json',
        })
      );

      logger.debug('Raw JSON uploaded', { hnId, key });
      return key;
    } catch (error) {
      logger.error('Failed to upload raw JSON', {
        hnId,
        key,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async uploadImage(hnId, imageBuffer, imageUrl) {
    // Extract file extension from URL
    const urlParts = imageUrl.split('.');
    const extension = urlParts[urlParts.length - 1].split('?')[0].toLowerCase();
    const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const ext = validExtensions.includes(extension) ? extension : 'jpg';

    const key = `images/${hnId}/image.${ext}`;

    try {
      logger.debug('Uploading image', { hnId, key, size: imageBuffer.length });

      const contentType = this.getContentType(ext);

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: imageBuffer,
          ContentType: contentType,
        })
      );

      logger.debug('Image uploaded', { hnId, key });
      return key;
    } catch (error) {
      logger.error('Failed to upload image', {
        hnId,
        key,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  getContentType(extension) {
    const contentTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    return contentTypes[extension] || 'application/octet-stream';
  }

  getPublicUrl(key) {
    // For MinIO local development, construct the URL
    // For production AWS S3, you'd use the S3 URL format
    const endpoint = process.env.S3_ENDPOINT || `https://${this.bucketName}.s3.amazonaws.com`;
    return `${endpoint}/${this.bucketName}/${key}`;
  }
}

module.exports = { S3ClientWrapper };
