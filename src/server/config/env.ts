import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  appUrl: string;
  sessionSecretConfigured: boolean;
}

const parsedPort = Number.parseInt(process.env.PORT ?? '3000', 10);

export const serverConfig: ServerConfig = {
  port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  sessionSecretConfigured: Boolean(process.env.SESSION_SECRET?.trim()),
};
