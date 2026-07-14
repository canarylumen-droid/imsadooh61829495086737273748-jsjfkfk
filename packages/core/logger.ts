export function createLogger(serviceName: string) {
  return {
    info: (message: string, context?: any) => {
      console.log(`${new Date().toLocaleTimeString()} [${serviceName}] [INFO] ${message}`, context ? JSON.stringify(context) : '');
    },
    warn: (message: string, context?: any) => {
      console.warn(`${new Date().toLocaleTimeString()} [${serviceName}] [WARN] ${message}`, context ? JSON.stringify(context) : '');
    },
    error: (message: string, context?: any) => {
      console.error(`${new Date().toLocaleTimeString()} [${serviceName}] [ERROR] ${message}`, context ? JSON.stringify(context) : '');
    },
    debug: (message: string, context?: any) => {
      if (process.env.DEBUG) {
        console.log(`${new Date().toLocaleTimeString()} [${serviceName}] [DEBUG] ${message}`, context ? JSON.stringify(context) : '');
      }
    }
  };
}
