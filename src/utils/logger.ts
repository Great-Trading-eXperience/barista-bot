import pino from 'pino';
import dotenv from 'dotenv';

dotenv.config();

const loggerOptions = {
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    },
    level: process.env.LOG_LEVEL || 'info',
};

const logger = pino(loggerOptions);

export default logger;