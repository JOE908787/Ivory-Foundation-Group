module.exports = {
  apps: [
    {
      name: 'ivory-portal',
      script: 'index.js',
      cwd: __dirname + '/../server',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: process.env.SESSION_SECRET || 'replace-with-a-secure-secret'
      }
    }
  ]
};
