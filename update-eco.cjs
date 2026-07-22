
const fs = require("fs");
const path = "/home/ubuntu/app/ecosystem.config.cjs";
let content = fs.readFileSync(path, "utf-8");
content = content.replace(/lead_recovery/g, "mysql_db");
fs.writeFileSync(path, content);
console.log("Updated ecosystem.config.cjs to use mysql_db");
const match = content.match(/MYSQL_DATABASE/g);
console.log("MYSQL_DATABASE occurrences:", match ? match.length : 0);
