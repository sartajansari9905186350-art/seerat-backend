const fs = require('fs');

const videoPath = 'C:\\Users\\sarta\\AppData\\Local\\Android\\Sdk\\emulator\\resources\\default.mp4';
const buf = fs.readFileSync(videoPath);
console.log('Video Path:', videoPath);
console.log('Video Size:', buf.length, 'bytes');
console.log('First 16 bytes (hex):', buf.slice(0, 16).toString('hex'));
console.log('Magic header (ascii):', buf.slice(4, 12).toString('ascii'));
