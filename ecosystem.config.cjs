module.exports = {
  apps: [
    {
      name: "mwg_backend",
      script: "src/server.js",           // ← YOUR ACTUAL ENTRY POINT
      instances: 1,                  // Use all CPU cores (cluster mode)
      exec_mode: "fork",
      watch: false,                      // Set true in dev if needed
      autorestart: true,
      max_restarts: 20,
      min_uptime: "15s",
      max_memory_restart: "500M",        // Restart if memory > 800MB
      env_file: "/home/ubuntu/env/mwg_backend.env",
      env: {
        NODE_ENV: "development",
        PORT: 5000
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000
      },
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      // Better logging
      interpreter: "node",
      interpreter_args: "--max-old-space-size=1024",
    }
  ]
};