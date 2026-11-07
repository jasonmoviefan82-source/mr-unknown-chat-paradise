export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (!env.CHAT_ROOMS) {
        return new Response("Chat binding is not configured.", { status: 503 });
      }

      const room = (url.searchParams.get("room") || "Welcome Lounge").slice(0, 50);
      const username = (url.searchParams.get("username") || "Guest").slice(0, 24);

      const id = env.CHAT_ROOMS.idFromName(room);
      return env.CHAT_ROOMS.get(id).fetch(requestWithIdentity(request, username));
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "online", site: "MR UNKNOWN'S CHAT PARADISE" });
    }

    return new Response(HTML, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
};

function requestWithIdentity(request, username) {
  const headers = new Headers(request.headers);
  headers.set("X-Chat-Username", username);
  return new Request(request, { headers });
}

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket connection required.", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const username = request.headers.get("X-Chat-Username") || "Guest";

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ username });

    const history = await this.ctx.storage.get("history") || [];

    server.send(JSON.stringify({
      type: "history",
      messages: history
    }));

    this.broadcast({
      type: "notice",
      text: username + " joined the room."
    }, server);

    this.sendUsers();

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

    if (data.type !== "message") return;

    const attachment = socket.deserializeAttachment() || {};
    const username = attachment.username || "Guest";
    const text = String(data.text || "").trim().slice(0, 500);

    if (!text) return;

    const entry = {
      username,
      text,
      time: new Date().toISOString()
    };

    const history = await this.ctx.storage.get("history") || [];
    history.push(entry);

    while (history.length > 100) history.shift();

    await this.ctx.storage.put("history", history);

    this.broadcast({
      type: "message",
      message: entry
    });
  }

  webSocketClose(socket) {
    const attachment = socket.deserializeAttachment() || {};
    this.broadcast({
      type: "notice",
      text: (attachment.username || "A member") + " left the room."
    }, socket);

    this.sendUsers();
  }

  webSocketError(socket) {
    try {
      socket.close();
    } catch {}
    this.sendUsers();
  }

  broadcast(data, except = null) {
    const message = JSON.stringify(data);

    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;

      try {
        socket.send(message);
      } catch {}
    }
  }

 sendUsers() {
    const users = this.ctx.getWebSockets()
        .filter(socket => socket.readyState === WebSocket.OPEN)
        .map(socket => {
            const attachment = socket.deserializeAttachment() || {};
            return attachment.username || "Guest";
        });

    this.broadcast({
        type: "users",
        users
    });
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MR UNKNOWN'S CHAT PARADISE</title>
<style>
*{box-sizing:border-box}
body{
 margin:0;font-family:Arial,sans-serif;color:white;min-height:100vh;
 background:linear-gradient(rgba(0,0,0,.70),rgba(0,0,0,.85)),
 url("https://i.ibb.co/SDCt8Vsq/3b80d00a-f405-45d7-96d8-1f391222bb8c.png")
 center/cover fixed;
}
header{text-align:center;background:rgba(0,0,0,.9);padding:22px;border-bottom:2px solid #b00000}
header h1{color:#ff2020;font-size:clamp(23px,5vw,38px);text-shadow:0 0 15px red;margin:0}
header p{color:#ddd;letter-spacing:3px;font-size:12px}
nav{background:#160000;display:flex;justify-content:center;flex-wrap:wrap;border-bottom:1px solid #700000}
nav button{background:none;border:0;color:white;padding:15px 18px;cursor:pointer;font-weight:bold}
nav button:hover{background:#750000}
.container{max-width:1200px;margin:25px auto;padding:15px}
.panel{background:rgba(0,0,0,.9);border:1px solid #8b0000;border-radius:9px;padding:20px;box-shadow:0 0 18px #6004}
h2{color:#ff3030;margin-top:0}
.login{max-width:430px;margin:35px auto;text-align:center}
input,textarea{width:100%;padding:13px;margin:8px 0;background:#171717;border:1px solid #700000;border-radius:5px;color:white}
.btn{background:#a00000;color:white;border:1px solid #ff3333;padding:12px 18px;border-radius:5px;cursor:pointer;font-weight:bold;margin:4px}
.btn:hover{background:#e00000}
.small{color:#aaa;font-size:12px}
.hidden{display:none!important}
.dashboard{display:grid;grid-template-columns:220px 1fr 190px;gap:15px;margin-top:20px}
.room{background:#171010;border:1px solid #500000;padding:13px;margin:9px 0;border-radius:5px;cursor:pointer}
.room:hover,.room.active{background:#610000;border-color:red}
.chat-area{min-height:330px;max-height:430px;overflow-y:auto;background:#101010;padding:14px;border:1px solid #500000;border-radius:5px}
.message{padding:9px;border-bottom:1px solid #292020;overflow-wrap:anywhere}
.message strong{color:#ff4444}
.users{color:#ddd;font-size:14px}
.status{color:#00dd77}
footer{text-align:center;padding:25px;color:#aaa;font-size:12px}
.video-box{background:#111;border:1px solid #700000;min-height:130px;padding:15px;text-align:center;margin:10px 0}
@media(max-width:750px){.dashboard{grid-template-columns:1fr}nav button{padding:12px 9px;font-size:12px}}
</style>
</head>
<body>
<header>
<h1>MR UNKNOWN'S CHAT PARADISE</h1>
<p>WHERE STRANGERS BECOME FRIENDS</p>
</header>

<nav>
<button onclick="showSection('home')">HOME</button>
<button onclick="showSection('rooms')">CHATROOMS</button>
<button onclick="showSection('media')">WEBCAMS</button>
<button onclick="showSection('admin')">ADMIN</button>
</nav>

<main class="container">
<section id="home" class="panel login">
<h2>WELCOME TO PARADISE</h2>
<p>Enter your username to explore the chat community.</p>
<input id="username" maxlength="24" placeholder="Choose your username">
<button class="btn" onclick="enterChat()">ENTER CHAT PARADISE</button>
<p class="small">Welcome to the MR UNKNOWN community!</p>
</section>

<section id="rooms" class="hidden">
<h2>THE CHATROOM LOUNGE</h2>
<p>Choose a room to explore.</p>
<div class="dashboard">
<div class="panel">
<h2>CHATROOMS</h2>
<div id="roomList"></div>
</div>

<div class="panel">
<h2 id="roomTitle">Welcome Lounge</h2>
<div class="chat-area" id="messages"></div>
<input id="chatInput" maxlength="500" placeholder="Type your message..." onkeydown="if(event.key==='Enter')sendMessage()">
<button class="btn" onclick="sendMessage()">SEND MESSAGE</button>
<p class="small" id="connection">Not connected</p>
</div>

<div class="panel">
<h2>MEMBERS</h2>
<div class="users" id="memberList"></div>
</div>
</div>
</section>

<section id="media" class="hidden panel">
<h2>WEBCAM & VOICE LOUNGE</h2>
<p>Your local camera preview.</p>
<div class="video-box">
<video id="preview" autoplay muted playsinline style="width:100%;max-height:300px;display:none"></video>
<p id="cameraMessage">Your camera preview will appear here.</p>
</div>
<button class="btn" onclick="startCamera()">START CAMERA</button>
<button class="btn" onclick="stopCamera()">STOP CAMERA</button>
<p class="small">Local camera preview only. Live broadcasting requires a separate video service.</p>
</section>

<section id="admin" class="hidden panel">
<h2>ADMIN CONTROL PANEL</h2>
<p>Owner and moderator controls.</p>
<div class="room">
<strong>MEMBER MANAGEMENT</strong>
<p>Member moderation controls will be added in a later stage.</p>
</div>
<div class="room">
<strong>ROOM MANAGEMENT</strong>
<p>Room management controls will be added in a later stage.</p>
</div>
<p class="small">Administrative permissions are not active yet. Secure owner authentication is required.</p>
</section>
</main>

<footer>MR UNKNOWN'S CHAT PARADISE<br>© 2026 - ALL RIGHTS RESERVED</footer>

<script>
let currentUser="";
let currentRoom="Welcome Lounge";
let socket=null;
let cameraStream=null;

const roomNames=[
"Welcome Lounge","General Chat","Music Lounge",
"Horror Movie Zone","Country Corner",
"Private Hangout","Members Lounge"
];

function showSection(id){
["home","rooms","media","admin"].forEach(name=>{
document.getElementById(name).classList.add("hidden");
});
document.getElementById(id).classList.remove("hidden");
}

function enterChat(){
const name=document.getElementById("username").value.trim();
if(!name){alert("Please choose a username!");return;}
currentUser=name;
buildRooms();
showSection("rooms");
selectRoom("Welcome Lounge");
}

function buildRooms(){
const list=document.getElementById("roomList");
list.replaceChildren();

roomNames.forEach(room=>{
const item=document.createElement("div");
item.className="room";
const label=document.createElement("strong");
label.textContent=room;
item.appendChild(label);
item.appendChild(document.createElement("br"));
const small=document.createElement("span");
small.className="small";
small.textContent="Chatroom";
item.appendChild(small);
item.onclick=()=>selectRoom(room);
list.appendChild(item);
});
}

function addMessage(username,text,time){
const line=document.createElement("div");
line.className="message";
const name=document.createElement("strong");
name.textContent=username+": ";
line.appendChild(name);
line.appendChild(document.createTextNode(text));
if(time){
const stamp=document.createElement("span");
stamp.className="small";
stamp.textContent="  "+new Date(time).toLocaleTimeString();
line.appendChild(stamp);
}
const messages=document.getElementById("messages");
messages.appendChild(line);
messages.scrollTop=messages.scrollHeight;
}

function selectRoom(room){
currentRoom=room;
document.getElementById("roomTitle").textContent=room;
document.getElementById("messages").replaceChildren();
document.querySelectorAll("#roomList .room").forEach((item,index)=>{
item.classList.toggle("active",roomNames[index]===room);
});
if(socket){
socket.close();
socket=null;
}
connectRoom();
}

function connectRoom(){
const protocol=location.protocol==="https:"?"wss:":"ws:";
const url=protocol+"//"+location.host+"/ws?room="+encodeURIComponent(currentRoom)+"&username="+encodeURIComponent(currentUser);
socket=new WebSocket(url);

socket.onopen=()=>{
document.getElementById("connection").textContent="● Connected to "+currentRoom;
};

socket.onmessage=event=>{
let data;
try{data=JSON.parse(event.data);}catch{return;}

if(data.type==="history"){
document.getElementById("messages").replaceChildren();
data.messages.forEach(message=>{
addMessage(message.username,message.text,message.time);
});
}
if(data.type==="message"){
addMessage(data.message.username,data.message.text,data.message.time);
}
if(data.type==="notice"){
addMessage("SYSTEM",data.text);
}
if(data.type==="users"){
const list=document.getElementById("memberList");
list.replaceChildren();
data.users.forEach(user=>{
const line=document.createElement("p");
line.className="status";
line.textContent="● "+user;
list.appendChild(line);
});
}
};

socket.onclose=()=>{
document.getElementById("connection").textContent="Disconnected";
};
socket.onerror=()=>{
document.getElementById("connection").textContent="Connection error";
};
}

function sendMessage(){
const input=document.getElementById("chatInput");
const message=input.value.trim();
if(!message||!socket||socket.readyState!==WebSocket.OPEN)return;
socket.send(JSON.stringify({type:"message",text:message}));
input.value="";
}

async function startCamera(){
try{
cameraStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
const video=document.getElementById("preview");
video.srcObject=cameraStream;
video.style.display="block";
document.getElementById("cameraMessage").textContent="Your local camera and microphone are active.";
}catch(error){
alert("Camera permission was not granted or the device is unavailable.");
}
}

function stopCamera(){
if(cameraStream){
cameraStream.getTracks().forEach(track=>track.stop());
cameraStream=null;
}
const video=document.getElementById("preview");
video.srcObject=null;
video.style.display="none";
document.getElementById("cameraMessage").textContent="Camera is stopped.";
}
</script>
</body>
</html>`;
