import pino from 'pino';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

const loggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        targets: [
            // Console transport with pretty printing
            {
                target: 'pino-pretty',
                level: process.env.LOG_LEVEL || 'info',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                },
            },
            // File transport for error logs
            {
                target: 'pino/file',
                level: 'error',
                options: {
                    destination: path.join(logsDir, 'error.log'),
                    mkdir: true,
                },
            },
        ],
    },
};

const logger = pino(loggerOptions);

export default logger;