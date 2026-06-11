
const { io } = require('socket.io-client');

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWEzMTdiNGE0Y2VmY2I0ODNhZTI3YjQiLCJpYXQiOjE3NzIyOTYxMjUsImV4cCI6MTc3MjI5OTcyNX0.Xh5uFefKYQJ4ieqeghjxxMksMfhlj-zRywgjDUUXSNg";

const socket = io("http://localhost:3000", {
  auth: {
    token: TOKEN,
  },
});


socket.on("connect", () => {
  console.log("✅ Connected");
  console.log("Socket ID:", socket.id);
});
socket.on("connect_error", (err) => {
  console.log("❌ Connection failed:", err.message);
});

socket.on("hello", (msg) => {
  console.log("Server says:", msg);
});
socket.on("notification", (payload, ack) => {
  console.log("New notification:", payload);
  // Acknowledge receipt so the server marks the notification as delivered
  if (typeof ack === 'function') ack();
});



