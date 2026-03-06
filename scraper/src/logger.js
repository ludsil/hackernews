class Logger {
  constructor(defaultContext = {}) {
    this.context = defaultContext;
  }

  log(level, message, context) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.context,
      ...context,
    };
    console.log(JSON.stringify(logEntry));
  }

  info(message, context) {
    this.log('info', message, context);
  }

  warn(message, context) {
    this.log('warn', message, context);
  }

  error(message, context) {
    this.log('error', message, context);
  }

  debug(message, context) {
    this.log('debug', message, context);
  }

  child(context) {
    return new Logger({ ...this.context, ...context });
  }
}

const logger = new Logger({ service: 'hn-scraper' });

module.exports = { Logger, logger };
