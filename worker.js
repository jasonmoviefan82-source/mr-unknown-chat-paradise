
const HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MR UNKNOWN'S CHAT PARADISE</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#090609;color:#eee;font-family:Arial,sans-serif;background-image:linear-gradient(#080408d9,#080408e8),url('https://i.ibb.co/SDCt8Vsq/3b80d00a-f405-45d7-96d8-1f391222bb.png');background-size:cover;background-position:center;background-attachment:fixed}
header{background:#100a12ed;border-bottom:3px solid #d22;padding:18px;text-align:center}
header h1{color:#f44;margin:0;font-size:28px;text-shadow:0 0 12px #900}
header p{margin:7px 0 0;color:#ddd}
nav{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;padding:15px;background:#130d16ed;border-bottom:2px solid #933}
nav button,.room-button,.send-button{background:#30202d;color:white;border:1px solid #e44;border-radius:7px;padding:12px 17px;font-weight:bold;cursor:pointer}
nav button:hover,.room-button:hover,.send-button:hover{background:#8d1824}
main{max-width:1450px;margin:28px auto;padding:0 15px}
h2{color:#f44}
.layout{display:grid;grid-template-columns:210px minmax(300px,1fr) 210px;gap:15px}
.panel{background:#130d19ed;border:2px solid #a33;border-radius:12px;padding:16px;min-width:0}
.rooms{display:flex;flex-direction:column;gap:9px}
.room-button{text-align:left;width:100%}
.room-button.active{background:#8b1827}
#messages{height:390px;overflow-y:auto;background:#17121c;border:1px solid #a55;border-radius:8px;padding:15px;margin-bottom:12px}
.message{padding:9px 4px;border-bottom:1px solid #493744;overflow-wrap:anywhere}
.message strong{color:#ff6464}
.system{color:#aaa;font-style:italic}
#messageInput{width:100%;padding:13px;background:#302438;color:white;border:1px solid #d55;border-radius:7px;font-size:16px}
.send-button{margin-top:10px;background:#c21f2b}
#members{padding:0;list-style:none}
#members li{padding:7px 0;color:#7fffc1;overflow-wrap:anywhere}
.status{font-size:13px;color:#aaa;margin-top:12px}
#connection{font-weight:bold}
footer{text-align:center;padding:30px 10px;color:#ddd;font-size:13px}
#login{position:fixed;inset:0;background:#050307ed;display:flex;align-items:center;justify-content:center;padding:20px;z-index:5}
.login-box{width:min(420px,100%);background:#160e1b;border:2px solid #d44;border-radius:12px;padding:25px;text-align:center}
.login-box h2{margin-top:0}
.login-box input{width:100%;padding:13px;background:#302438;color:white;border:1px solid #d55;border-radius:7px;font-size:16px;margin:10px 0}
#loginError{color:#ff8888}
@media(max-width:850px){.layout{grid-template-columns:1fr}.rooms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}#messages{height:330px}}
</style>
</head>
<body>
<header>
<h1>MR UNKNOWN'S CHAT PARADISE</h1>
<p>WHERE STRANGERS BECOME FRIENDS</p>
</header>
<nav>
<button onclick="showSection('home')">HOME</button>
<button onclick="showSection('chat')">CHATROOMS</button>
<button onclick="showSection('webcams')">WEBCAMS</button>
<button onclick="showSection('admin')">ADMIN</button>
</nav>
<main>
<section id="home" class="panel">
<h2>WELCOME TO CHAT PARADISE</h2>
<p>Choose a room and join the conversation.</p>
<button class="send-button" onclick="showSection('chat')">ENTER CHATROOMS</button>
</section>
<section id="chat" style="display:none">
<div class="layout">
<aside class="panel">
<h2>CHATROOMS</h2>
<div class="rooms" id="rooms"></div>
</aside>
<div class="panel">
<h2 id="roomTitle">Welcome Lounge</h2>
<div id="messages" aria-live="polite"></div>
<form id="chatForm">
<input id="messageInput" maxlength="1000" placeholder="Type your message..." autocomplete="off">
<button class="send-button" type="submit">SEND MESSAGE</button>
</form>
<div class="status">Connection: <span id="connection">Connecting...</span></div>
</div>
<aside class="panel">
<h2>MEMBERS ONLINE</h2>
<ul id="members"></ul>
<p class="status" id="memberCount">0 members online</p>
</aside>
</div>
</section>
<section id="webcams" class="panel" style="display:none">
<h2>WEBCAMS</h2>
<p>Camera preview is available on this device when you grant browser permission.</p>
<video id="camera" autoplay playsinline muted style="width:100%;max-width:500px;background:#080808"></video>
<p><button class="send-button" onclick="startCamera()">START CAMERA PREVIEW</button></p>
<p class="status">This is a local preview. It does not broadcast video to other members.</p>
</section>
<section id="admin" class="panel" style="display:none">
<h2>ADMIN</h2>
<p>Welcome to the chatroom administration area.</p>
<p class="status">Administrative controls can be added after the live chat is verified.</p>
</section>
</main>
<footer>MR UNKNOWN'S CHAT PARADISE<br>© 2026 - ALL RIGHTS RESERVED</footer>

<div id="login">
<div class="login-box">
<h2>ENTER CHAT PARADISE</h2>
<p>Choose a chatroom username.</p>
<input id="usernameInput" maxlength="24" placeholder="Your username" autocomplete="nickname">
<button class="send-button" onclick="joinChat()">JOIN CHAT</button>
<p id="loginError"></p>
</div>
</div>

<script>
const roomNames=["Welcome Lounge","General Chat","Music Lounge","Horror Movie Zone","Country Corner","Private Hangout","Members Lounge"];
let username="",room="Welcome Lounge",socket=null,reconnectTimer=null,manualClose=false;
const $=id=>document.getElementById(id);
function showSection(name){
["home","chat","webcams","admin"].forEach(id=>$(id).style.display=id===name?"block":"none");
}
function buildRooms(){
$("rooms").innerHTML="";
roomNames.forEach(name=>{
const b=document.createElement("button");
b.className="room-button"+(name===room?" active":"");
b.textContent=name;
b.onclick=()=>changeRoom(name);
$("rooms").appendChild(b);
});
}
function setStatus(text,color){
$("connection").textContent=text;
$("connection").style.color=color||"#aaa";
}
function addMessage(item){
const div=document.createElement("div");
div.className="message"+(item.type==="system"?" system":"");
if(item.type==="system"){
div.textContent=item.text;
}else{
const strong=document.createElement("strong");
strong.textContent=(item.username||"Guest")+": ";
div.appendChild(strong);
div.appendChild(document.createTextNode(item.text||""));
}
$("messages").appendChild(div);
$("messages").scrollTop=$("messages").scrollHeight;
}
function updateMembers(users){
$("members").innerHTML="";
users.forEach(name=>{
const li=document.createElement("li");
li.textContent="● "+name;
$("members").appendChild(li);
});
$("memberCount").textContent=users.length+" member"+(users.length===1?"":"s")+" online";
}
function connect(){
manualClose=false;
if(socket){try{socket.close()}catch(e){}}
$("messages").innerHTML="";
updateMembers([]);
setStatus("Connecting...");
const url=new URL("/ws",location.href);
url.protocol=location.protocol==="https:"?"wss:":"ws:";
url.searchParams.set("room",room);
url.searchParams.set("username",username);
const ws=new WebSocket(url);
socket=ws;
ws.onopen=()=>{if(socket===ws)setStatus("Connected","#71ffae")};
ws.onmessage=event=>{
if(socket!==ws)return;
let data;
try{data=JSON.parse(event.data)}catch(e){return}
if(data.type==="history"){
$("messages").innerHTML="";
(data.messages||[]).forEach(addMessage);
}else if(data.type==="message"||data.type==="system"){
addMessage(data);
}else if(data.type==="users"){
updateMembers(data.users||[]);
}else if(data.type==="pong"){
setStatus("Connected","#71ffae");
}
};
ws.onerror=()=>{if(socket===ws)setStatus("Connection error","#ff7777")};
ws.onclose=()=>{
if(socket!==ws)return;
setStatus("Disconnected - reconnecting","#ff7777");
if(!manualClose)reconnectTimer=setTimeout(connect,3000);
};
}
function joinChat(){
const name=$("usernameInput").value.trim().replace(/\s+/g," ");
if(name.length<2){$("loginError").textContent="Please enter at least 2 characters.";return}
username=name.slice(0,24);
$("login").style.display="none";
showSection("chat");
buildRooms();
connect();
}
function changeRoom(name){
if(name===room)return;
room=name;
$("roomTitle").textContent=room;
buildRooms();
if(socket)connect();
}
$("chatForm").addEventListener("submit",event=>{
event.preventDefault();
const text=$("messageInput").value.trim();
if(!text)return;
if(!socket||socket.readyState!==WebSocket.OPEN){setStatus("Not connected - please wait","#ff7777");return}
socket.send(JSON.stringify({type:"message",text:text.slice(0,1000)}));
$("messageInput").value="";
});
setInterval(()=>{
if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"ping"}));
},20000);
async function startCamera(){
try{
const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
$("camera").srcObject=stream;
}catch(e){alert("Camera permission was not granted or no camera is available.");}
}
window.addEventListener("beforeunload",()=>{manualClose=true;if(socket)socket.close()});
$("usernameInput").addEventListener("keydown",e=>{if(e.key==="Enter")joinChat()});
buildRooms();
</script>
</body>
</html>`;

function cleanName(value) {
  return String(value || "Guest")
    .replace(/[^\w .-]/g, "")
    .trim()
    .slice(0, 24) || "Guest";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "MR UNKNOWN'S CHAT PARADISE" });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }

      const room = cleanName(url.searchParams.get("room") || "Welcome Lounge");
      const username = cleanName(url.searchParams.get("username") || "Guest");

      const id = env.CHAT_ROOMS.idFromName(room);
      const stub = env.CHAT_ROOMS.get(id);

      // Pass the room and username through to the Durable Object.
      url.searchParams.set("room", room);
      url.searchParams.set("username", username);
      return stub.fetch(new Request(url.toString(), request));
    }

    return new Response(HTML, {
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cache-control": "no-store"
      }
    });
  }
};

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const url = new URL(request.url);
    const username = cleanName(url.searchParams.get("username"));
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.serializeAttachment({
      username,
      lastSeen: Date.now()
    });

    this.ctx.acceptWebSocket(server);

    const history = await this.ctx.storage.get("messages") || [];
    server.send(JSON.stringify({ type: "history", messages: history }));

    this.broadcast({
      type: "system",
      text: username + " joined the room."
    }, server);

    this.sendUsers();
    await this.scheduleCleanup();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const attachment = ws.deserializeAttachment() || {
      username: "Guest",
      lastSeen: Date.now()
    };

    attachment.lastSeen = Date.now();
    ws.serializeAttachment(attachment);

    if (data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      this.sendUsers();
      await this.scheduleCleanup();
      return;
    }

    if (data.type !== "message") return;

    const text = String(data.text || "").trim().slice(0, 1000);
    if (!text) return;

    const item = {
      type: "message",
      username: cleanName(attachment.username),
      text,
      time: Date.now()
    };

    const history = await this.ctx.storage.get("messages") || [];
    history.push(item);
    await this.ctx.storage.put("messages", history.slice(-100));

    this.broadcast(item);
    await this.scheduleCleanup();
  }

  webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();
    const username = cleanName(attachment?.username || "A member");

    this.broadcast({
      type: "system",
      text: username + " left the room."
    });

    this.sendUsers();
    this.scheduleCleanup();
  }

  webSocketError(ws) {
    try { ws.close(1011, "Connection error"); } catch {}
    this.sendUsers();
    this.scheduleCleanup();
  }

  broadcast(data, exceptSocket) {
    const payload = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exceptSocket) continue;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      } catch {}
    }
  }

  sendUsers() {
    const now = Date.now();
    const users = [];

    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const info = ws.deserializeAttachment();
        if (!info || now - info.lastSeen > 70000) continue;
        if (info.username && !users.includes(info.username)) {
          users.push(info.username);
        }
      } catch {}
    }

    const payload = JSON.stringify({ type: "users", users });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      } catch {}
    }
  }

  async scheduleCleanup() {
    await this.ctx.storage.setAlarm(Date.now() + 30000);
  }

  async alarm() {
    const now = Date.now();

    for (const ws of this.ctx.getWebSockets()) {
      try {
        const info = ws.deserializeAttachment();
        if (!info || now - info.lastSeen > 70000) {
          ws.close(1000, "Inactive connection");
        }
      } catch {
        try { ws.close(1011, "Connection cleanup"); } catch {}
      }
    }

    this.sendUsers();

    if (this.ctx.getWebSockets().length > 0) {
      await this.scheduleCleanup();
    }
  }
};
