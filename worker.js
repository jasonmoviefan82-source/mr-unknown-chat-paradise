export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "online" });
    }

    if (url.pathname === "/ws") {
      if (!env.CHAT_ROOMS) {
        return new Response("CHAT_ROOMS binding is missing", { status: 500 });
      }

      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }

      const room = (url.searchParams.get("room") || "Welcome Lounge").slice(0, 50);
      const username = (url.searchParams.get("username") || "Guest").slice(0, 24);

      const id = env.CHAT_ROOMS.idFromName(room);
      const stub = env.CHAT_ROOMS.get(id);

      return stub.fetch(request);
    }

    return new Response(HTML, {
      headers: { "Content-Type": "text/html;charset=UTF-8" }
    });
  }
};

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    const url = new URL(request.url);
    const username = (url.searchParams.get("username") || "Guest").slice(0, 24);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      username,
      lastSeen: Date.now()
    });

    const history = await this.ctx.storage.get("messages") || [];

    server.send(JSON.stringify({
      type: "history",
      messages: history
    }));

    this.broadcast({
      type: "notice",
      text: username + " joined the room."
    }, server);

    this.sendUsers();
    await this.scheduleCleanup();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(socket, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const attachment = socket.deserializeAttachment() || {};
    attachment.lastSeen = Date.now();
    socket.serializeAttachment(attachment);

    if (data.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      await this.scheduleCleanup();
      return;
    }

    if (data.type !== "chat") return;

    const text = String(data.text || "").trim().slice(0, 500);
    if (!text) return;

    const chatMessage = {
      type: "message",
      username: attachment.username || "Guest",
      text,
      time: new Date().toLocaleTimeString()
    };

    const messages = await this.ctx.storage.get("messages") || [];
    messages.push(chatMessage);

    await this.ctx.storage.put("messages", messages.slice(-100));

    this.broadcast(chatMessage);
  }

  async webSocketClose(socket, code, reason, wasClean) {
    const attachment = socket.deserializeAttachment() || {};

    this.broadcast({
      type: "notice",
      text: (attachment.username || "A member") + " left the room."
    });

    this.sendUsers();
    await this.scheduleCleanup();
  }

  async webSocketError(socket, error) {
    const attachment = socket.deserializeAttachment() || {};

    try {
      socket.close(1011, "Connection error");
    } catch {}

    this.broadcast({
      type: "notice",
      text: (attachment.username || "A member") + " disconnected."
    });

    this.sendUsers();
    await this.scheduleCleanup();
  }

  broadcast(data, exceptSocket) {
    const message = JSON.stringify(data);

    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exceptSocket) continue;

      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
        } catch {}
      }
    }
  }

  sendUsers() {
    const users = [];

    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;

      const attachment = socket.deserializeAttachment() || {};
      users.push(attachment.username || "Guest");
    }

    this.broadcast({
      type: "users",
      users
    });
  }

  async scheduleCleanup() {
    await this.ctx.storage.setAlarm(Date.now() + 30000);
  }

  async alarm() {
    const now = Date.now();
    let removed = false;

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      const lastSeen = attachment.lastSeen || 0;

      if (now - lastSeen > 70000) {
        try {
          socket.close(1000, "Connection timed out");
        } catch {}

        removed = true;
      }
    }

    if (removed) {
      this.sendUsers();
    }

    if (this.ctx.getWebSockets().length > 0) {
      await this.scheduleCleanup();
    }
  }
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MR UNKNOWN'S CHAT PARADISE</title>
<style>
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 20px;
  background: #090000 url('https://i.ibb.co/SDCt8Vsq/3b80d00a-f405-45d7-96d8-1f391222bb.png') center center / cover fixed;
  color: white;
  font-family: Arial, sans-serif;
}

header {
  text-align: center;
  padding: 25px 10px;
  background: rgba(0,0,0,.88);
  border: 2px solid #a00000;
  box-shadow: 0 0 20px red;
  margin-bottom: 20px;
}

h1 {
  color: #ff2020;
  text-shadow: 0 0 12px red;
  font-size: clamp(24px, 5vw, 42px);
}

header p { color: #ddd; }

nav {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

button {
  background: #850000;
  border: 1px solid red;
  color: white;
  padding: 11px 17px;
  cursor: pointer;
  border-radius: 5px;
  font-weight: bold;
}

button:hover { background: #c00000; }

.panel {
  background: rgba(0,0,0,.92);
  border: 1px solid #a00000;
  padding: 18px;
  border-radius: 8px;
  margin-bottom: 18px;
}

input {
  width: 100%;
  padding: 12px;
  background: #171717;
  border: 1px solid #900000;
  color: white;
  margin: 8px 0;
  border-radius: 4px;
}

.hidden { display: none !important; }

#layout {
  display: grid;
  grid-template-columns: 190px minmax(0,1fr) 190px;
  gap: 15px;
}

.room {
  display: block;
  width: 100%;
  margin-bottom: 9px;
  text-align: left;
}

.room.active { background: #c00000; }

#messages {
  height: 360px;
  overflow-y: auto;
  background: #080808;
  border: 1px solid #500000;
  padding: 12px;
  margin-bottom: 12px;
}

.message {
  padding: 8px;
  border-bottom: 1px solid #292020;
  overflow-wrap: anywhere;
}

.message strong { color: #ff4444; }
.message small { color: #999; margin-left: 8px; }

.notice {
  color: #ffb0b0;
  font-style: italic;
  padding: 7px;
}

#onlineList { line-height: 2; }

#connection { color: #ff7777; }

#webcamVideo {
  max-width: 100%;
  background: black;
}

@media(max-width: 800px) {
  #layout { grid-template-columns: 1fr; }
  #messages { height: 300px; }
}
</style>
</head>
<body>

<header>
<h1>MR UNKNOWN'S CHAT PARADISE</h1>
<p>WHERE STRANGERS BECOME FRIENDS</p>
</header>

<nav>
<button onclick="showPage('home')">HOME</button>
<button onclick="showPage('chat')">CHATROOMS</button>
<button onclick="showPage('webcam')">WEBCAMS</button>
<button onclick="showPage('admin')">ADMIN</button>
</nav>

<section id="home" class="panel">
<h2>WELCOME TO PARADISE</h2>
<p>Enter your username to join the chat.</p>
<input id="username" maxlength="24" placeholder="Enter your username">
<button onclick="enterChat()">ENTER CHAT PARADISE</button>
</section>

<section id="chat" class="hidden">
<div id="layout">

<div class="panel">
<h3>CHATROOMS</h3>
<div id="rooms"></div>
</div>

<div class="panel">
<h2 id="roomTitle">Welcome Lounge</h2>
<p>Connection: <span id="connection">Disconnected</span></p>

<div id="messages"></div>

<input id="messageInput" maxlength="500" placeholder="Type your message..."
onkeydown="if(event.key==='Enter') sendMessage()">

<button onclick="sendMessage()">SEND MESSAGE</button>
</div>

<div class="panel">
<h3>ONLINE MEMBERS</h3>
<p>Online: <span id="onlineCount">0</span></p>
<div id="onlineList"></div>
</div>

</div>
</section>

<section id="webcam" class="panel hidden">
<h2>WEBCAM & VOICE LOUNGE</h2>
<p>Local camera preview only. This does not broadcast video to other members.</p>
<video id="webcamVideo" autoplay muted playsinline></video>
<br><br>
<button onclick="startCamera()">START CAMERA</button>
<button onclick="stopCamera()">STOP CAMERA</button>
</section>

<section id="admin" class="panel hidden">
<h2>ADMIN CONTROL PANEL</h2>
<p>Administration tools can be added here in a later update.</p>
</section>

<script>
var username = "";
var currentRoom = "Welcome Lounge";
var ws = null;
var cameraStream = null;
var heartbeat = null;

var roomNames = [
"Welcome Lounge",
"General Chat",
"Music Lounge",
"Horror Movie Zone",
"Country Corner",
"Private Hangout",
"Members Lounge"
];

function showPage(page) {
  ["home","chat","webcam","admin"].forEach(function(id) {
    document.getElementById(id).classList.add("hidden");
  });
  document.getElementById(page).classList.remove("hidden");
}

function enterChat() {
  var name = document.getElementById("username").value.trim();
  if (!name) {
    alert("Please enter a username.");
    return;
  }

  username = name.slice(0,24);
  buildRooms();
  showPage("chat");
  selectRoom("Welcome Lounge");
}

function buildRooms() {
  var container = document.getElementById("rooms");
  container.textContent = "";

  roomNames.forEach(function(room) {
    var button = document.createElement("button");
    button.className = "room";
    button.textContent = room;
    button.onclick = function() { selectRoom(room); };
    container.appendChild(button);
  });
}

function selectRoom(room) {
  currentRoom = room;
  document.getElementById("roomTitle").textContent = room;
  document.getElementById("messages").textContent = "";

  document.querySelectorAll(".room").forEach(function(button) {
    button.classList.toggle("active", button.textContent === room);
  });

  connectRoom();
}

function connectRoom() {
  if (ws) {
    clearInterval(heartbeat);
    ws.onclose = null;
    ws.close();
  }

  document.getElementById("connection").textContent = "Connecting...";
  document.getElementById("onlineList").textContent = "";
  document.getElementById("onlineCount").textContent = "0";

  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var url = protocol + "//" + location.host + "/ws?room=" +
    encodeURIComponent(currentRoom) + "&username=" +
    encodeURIComponent(username);

  ws = new WebSocket(url);

  ws.onopen = function() {
    document.getElementById("connection").textContent = "Connected";
    heartbeat = setInterval(function() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({type:"ping"}));
      }
    }, 20000);
  };

  ws.onmessage = function(event) {
    var data;

    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "history") {
      document.getElementById("messages").textContent = "";
      (data.messages || []).forEach(addMessage);
    }

    if (data.type === "message" || data.type === "notice") {
      addMessage(data);
    }

    if (data.type === "users") {
      updateUsers(data.users || []);
    }
  };

  ws.onclose = function() {
    clearInterval(heartbeat);
    document.getElementById("connection").textContent = "Disconnected";
  };

  ws.onerror = function() {
    document.getElementById("connection").textContent = "Connection error";
  };
}

function addMessage(data) {
  var container = document.getElementById("messages");
  var item = document.createElement("div");

  if (data.type === "notice") {
    item.className = "notice";
    item.textContent = data.text || "";
  } else {
    item.className = "message";

    var name = document.createElement("strong");
    name.textContent = data.username || "Guest";

    var time = document.createElement("small");
    time.textContent = data.time || "";

    var text = document.createElement("div");
    text.textContent = data.text || "";

    item.appendChild(name);
    item.appendChild(time);
    item.appendChild(text);
  }

  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function updateUsers(users) {
  var list = document.getElementById("onlineList");
  list.textContent = "";
  document.getElementById("onlineCount").textContent = users.length;

  users.forEach(function(name) {
    var item = document.createElement("div");
    item.textContent = "● " + name;
    list.appendChild(item);
  });
}

function sendMessage() {
  var input = document.getElementById("messageInput");
  var text = input.value.trim();

  if (!text) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("You are not connected to the room.");
    return;
  }

  ws.send(JSON.stringify({
    type: "chat",
    text: text.slice(0,500)
  }));

  input.value = "";
}

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    document.getElementById("webcamVideo").srcObject = cameraStream;
  } catch(error) {
    alert("Camera access was not available. Check browser permissions.");
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(function(track) {
      track.stop();
    });
    cameraStream = null;
  }

  document.getElementById("webcamVideo").srcObject = null;
}
</script>

</body>
</html>`;
