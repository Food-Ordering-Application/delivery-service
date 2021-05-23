module.exports = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: [__dirname + '/**/*.entity.{js,ts}'],
  migrations: ['src/database/migrations/**/*{.ts,.js}'],
  synchronize: true,
  seeds: [__dirname + '/**/seeders/**/*.seed{.ts,.js}'],
  factories: [__dirname + '/**/factories/**/*.factory{.ts,.js}'],
  ssl: true,
  migrationsDir: 'src/database/migrations',
  cli: {
    migrationsDir: 'src/database/migrations',
  },
  extra: {
    ssl: {
      rejectUnauthorized: false,
    },
  },
};
