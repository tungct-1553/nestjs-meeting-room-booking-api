import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/env.validation';
import { databaseOptions } from './options';
const env = validateEnvironment(process.env);
export default new DataSource(databaseOptions(String(env.DATABASE_URL), Number(env.DB_POOL_MAX)));
