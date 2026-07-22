
const { execSync } = require("child_process");
execSync("pm2 restart audnix-api-gateway audnix-worker-lead-recovery --update-env", { stdio: "inherit", timeout: 15000 });
console.log("Services restarted with --update-env");
