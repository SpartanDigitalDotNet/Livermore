import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration for file transport
 */
export interface FileTransportConfig {
  /** Base directory for logs (default: 'logs') */
  logDir: string;
  /** Service name for file grouping (e.g., 'api', 'indicators') */
  service: string;
  /** Max file size in bytes before rotation (default: 50MB) */
  maxSize: number;
  /** Number of rotated files to keep (default: 10) */
  maxFiles: number;
  /** Write errors to separate .error.log file */
  separateErrorLog: boolean;
}

/**
 * Default file transport configuration
 */
export const DEFAULT_FILE_CONFIG: FileTransportConfig = {
  logDir: 'logs',
  service: 'livermore',
  maxSize: 50 * 1024 * 1024, // 50MB
  maxFiles: 10,
  separateErrorLog: true,
};

/**
 * Get the current date string for log file naming
 */
function getDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * File transport for writing logs to disk with rotation
 *
 * Features:
 * - Daily log files: {service}-{YYYY-MM-DD}.log
 * - Automatic rotation at maxSize
 * - Separate error logs for quick error scanning
 * - JSON format for machine parsing
 */
export class FileTransport {
  private config: FileTransportConfig;
  private currentDate: string;
  private mainStream: fs.WriteStream | null = null;
  private errorStream: fs.WriteStream | null = null;
  private perfStream: fs.WriteStream | null = null;
  private mainFileSize = 0;
  private errorFileSize = 0;
  private perfFileSize = 0;

  constructor(config: Partial<FileTransportConfig> = {}) {
    this.config = { ...DEFAULT_FILE_CONFIG, ...config };
    this.currentDate = getDateString();
    this.ensureLogDirectory();
  }

  /**
   * Ensure the log directory exists
   */
  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * Get the log file path for a given type
   */
  private getLogFilePath(type: 'main' | 'error' | 'perf', date: string): string {
    const suffix = type === 'main' ? '.log' : `.${type}.log`;
    return path.join(
      this.config.logDir,
      `${this.config.service}-${date}${suffix}`
    );
  }

  /**
   * Check if date has changed and rotate if needed
   */
  private checkDateRotation(): void {
    const today = getDateString();
    if (today !== this.currentDate) {
      this.closeStreams();
      this.currentDate = today;
      this.mainFileSize = 0;
      this.errorFileSize = 0;
      this.perfFileSize = 0;
    }
  }

  /**
   * Rotate a log file if it exceeds maxSize
   */
  private rotateIfNeeded(
    type: 'main' | 'error' | 'perf',
    currentSize: number
  ): boolean {
    if (currentSize < this.config.maxSize) {
      return false;
    }

    const filePath = this.getLogFilePath(type, this.currentDate);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    // Close the current stream
    if (type === 'main' && this.mainStream) {
      this.mainStream.end();
      this.mainStream = null;
    } else if (type === 'error' && this.errorStream) {
      this.errorStream.end();
      this.errorStream = null;
    } else if (type === 'perf' && this.perfStream) {
      this.perfStream.end();
      this.perfStream = null;
    }

    // Rotate existing files
    this.rotateFiles(type);

    // Reset size counter
    if (type === 'main') this.mainFileSize = 0;
    else if (type === 'error') this.errorFileSize = 0;
    else if (type === 'perf') this.perfFileSize = 0;

    return true;
  }

  /**
   * Rotate files by renaming with numeric suffix
   */
  private rotateFiles(type: 'main' | 'error' | 'perf'): void {
    const basePath = this.getLogFilePath(type, this.currentDate);

    // Delete oldest file if it exists
    const oldestPath = `${basePath}.${this.config.maxFiles}`;
    if (fs.existsSync(oldestPath)) {
      fs.unlinkSync(oldestPath);
    }

    // Shift existing rotated files
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = `${basePath}.${i}`;
      const newPath = `${basePath}.${i + 1}`;
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      }
    }

    // Rename current file to .1
    if (fs.existsSync(basePath)) {
      fs.renameSync(basePath, `${basePath}.1`);
    }
  }

  /**
   * Get or create the write stream for a log type
   */
  private getStream(type: 'main' | 'error' | 'perf'): fs.WriteStream {
    this.checkDateRotation();

    const filePath = this.getLogFilePath(type, this.currentDate);

    if (type === 'main') {
      this.rotateIfNeeded('main', this.mainFileSize);
      if (!this.mainStream) {
        this.mainStream = fs.createWriteStream(filePath, { flags: 'a' });
        // Get current file size if file exists
        if (fs.existsSync(filePath)) {
          this.mainFileSize = fs.statSync(filePath).size;
        }
      }
      return this.mainStream;
    } else if (type === 'error') {
      this.rotateIfNeeded('error', this.errorFileSize);
      if (!this.errorStream) {
        this.errorStream = fs.createWriteStream(filePath, { flags: 'a' });
        if (fs.existsSync(filePath)) {
          this.errorFileSize = fs.statSync(filePath).size;
        }
      }
      return this.errorStream;
    } else {
      this.rotateIfNeeded('perf', this.perfFileSize);
      if (!this.perfStream) {
        this.perfStream = fs.createWriteStream(filePath, { flags: 'a' });
        if (fs.existsSync(filePath)) {
          this.perfFileSize = fs.statSync(filePath).size;
        }
      }
      return this.perfStream;
    }
  }

  /**
   * Write a log entry to the main log file
   */
  write(entry: Record<string, unknown>): void {
    const line = JSON.stringify(entry) + '\n';
    const stream = this.getStream('main');
    stream.write(line);
    this.mainFileSize += Buffer.byteLength(line, 'utf8');

    // Also write errors to separate error log if enabled
    const level = entry.level as string | undefined;
    if (
      this.config.separateErrorLog &&
      (level === 'ERROR' || level === 'FATAL')
    ) {
      this.writeError(entry);
    }
  }

  /**
   * Write a log entry to the error log file
   */
  writeError(entry: Record<string, unknown>): void {
    const line = JSON.stringify(entry) + '\n';
    const stream = this.getStream('error');
    stream.write(line);
    this.errorFileSize += Buffer.byteLength(line, 'utf8');
  }

  /**
   * Write a performance entry to the perf log file
   */
  writePerf(entry: Record<string, unknown>): void {
    const line = JSON.stringify(entry) + '\n';
    const stream = this.getStream('perf');
    stream.write(line);
    this.perfFileSize += Buffer.byteLength(line, 'utf8');
  }

  /**
   * Close all open streams
   */
  closeStreams(): void {
    if (this.mainStream) {
      this.mainStream.end();
      this.mainStream = null;
    }
    if (this.errorStream) {
      this.errorStream.end();
      this.errorStream = null;
    }
    if (this.perfStream) {
      this.perfStream.end();
      this.perfStream = null;
    }
  }

  /**
   * Flush all streams (for graceful shutdown)
   */
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      const streams = [this.mainStream, this.errorStream, this.perfStream].filter(
        Boolean
      ) as fs.WriteStream[];

      if (streams.length === 0) {
        resolve();
        return;
      }

      let pending = streams.length;
      const done = () => {
        pending--;
        if (pending === 0) resolve();
      };

      for (const stream of streams) {
        stream.once('drain', done);
        if (stream.writableLength === 0) {
          done();
        }
      }
    });
  }
}
