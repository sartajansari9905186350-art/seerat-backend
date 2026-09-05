const { execSync } = require('child_process');
const adb = 'C:\\Users\\sarta\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';

try {
  execSync(`"${adb}" -s 4L7X8XDYXWYH9LNF shell uiautomator dump /sdcard/u.xml`, { stdio: 'inherit' });
  const xml = execSync(`"${adb}" -s 4L7X8XDYXWYH9LNF shell cat /sdcard/u.xml`).toString('utf8');
  
  const regex = /<node[^>]*text="([^"]*)"[^>]*resource-id="([^"]*)"[^>]*class="([^"]*)"[^>]*content-desc="([^"]*)"[^>]*bounds="([^"]*)"/g;
  let m;
  console.log("=== PARSED UI ELEMENTS ===");
  while ((m = regex.exec(xml)) !== null) {
    const text = m[1];
    const resId = m[2];
    const cls = m[3];
    const desc = m[4];
    const bounds = m[5];
    if (text || desc) {
      console.log(`TEXT: "${text}" | DESC: "${desc}" | CLASS: ${cls} | BOUNDS: ${bounds}`);
    }
  }
} catch (e) {
  console.error("Error:", e.message);
}
