export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "online", site: "MR UNKNOWN'S CHAT PARADISE" });
    }

    if (url.pathname === "/ws") {
      if (!env.CHAT_ROOMS) {
        return new Response("Chat binding is not configured.", { status: 503 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket upgrade required.", { status: 426 });
      }

      const room = cleanText(url.searchParams.get("room") || "Welcome Lounge", 50);
      const username = cleanText(url.searchParams.get("username") || "Guest", 24) || "Guest";
      const id = env.CHAT_ROOMS.idFromName(room);
      const headers = new Headers(request.headers);
      headers.set("X-Chat-Username", username);
      headers.set("X-Chat-Room", room);
      return env.CHAT_ROOMS.get(id).fetch(new Request(request, { headers }));
    }

    return new Response(HTML, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      }
    });
  }
};

function cleanText(value, max) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const username = request.headers.get("X-Chat-Username") || "Guest";
    const peerId = crypto.randomUUID();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ username, peerId, muted: false });

    const history = (await this.ctx.storage.get("history")) || [];
    server.send(JSON.stringify({ type: "welcome", peerId, messages: history }));

    this.broadcast({
      type: "notice",
      text: username + " joined the room."
    }, server);

    this.sendUsers();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const attachment = socket.deserializeAttachment() || {};
    const username = attachment.username || "Guest";

    if (data.type === "message") {
      if (attachment.muted) {
        socket.send(JSON.stringify({ type: "notice", text: "You are muted by the room owner." }));
        return;
      }
      const text = cleanText(data.text, 500);
      if (!text) return;

      const entry = {
        id: crypto.randomUUID(),
        username,
        text,
        time: new Date().toISOString()
      };
      const history = (await this.ctx.storage.get("history")) || [];
      history.push(entry);
      while (history.length > 100) history.shift();
      await this.ctx.storage.put("history", history);
      this.broadcast({ type: "message", message: entry });
      return;
    }

    if (data.type === "signal") {
      const target = String(data.target || "");
      const recipient = this.ctx.getWebSockets().find(ws => {
        const a = ws.deserializeAttachment() || {};
        return a.peerId === target;
      });
      if (recipient) {
        recipient.send(JSON.stringify({
          type: "signal",
          from: attachment.peerId,
          signal: data.signal
        }));
      }
      return;
    }

    if (data.type === "admin") {
      const secret = String(data.secret || "");
      if (!this.env.OWNER_SECRET || secret !== this.env.OWNER_SECRET) {
        socket.send(JSON.stringify({ type: "adminResult", ok: false, text: "Owner login failed." }));
        return;
      }

      const action = String(data.action || "");
      if (action === "login") {
        socket.send(JSON.stringify({ type: "adminResult", ok: true, text: "Owner login successful." }));
        return;
      }

      if (action === "clear") {
        await this.ctx.storage.put("history", []);
        this.broadcast({ type: "clear" });
        socket.send(JSON.stringify({ type: "adminResult", ok: true, text: "This room's chat history was cleared." }));
        return;
      }

      const targetId = String(data.target || "");
      const targetSocket = this.ctx.getWebSockets().find(ws => {
        const a = ws.deserializeAttachment() || {};
        return a.peerId === targetId;
      });

      if (!targetSocket) {
        socket.send(JSON.stringify({ type: "adminResult", ok: false, text: "That member is no longer connected." }));
        return;
      }

      const targetAttachment = targetSocket.deserializeAttachment() || {};
      if (action === "kick") {
        try {
          targetSocket.send(JSON.stringify({ type: "kicked", text: "The room owner removed you from this room." }));
          targetSocket.close(4001, "Removed by room owner");
        } catch {}
        this.broadcast({ type: "notice", text: (targetAttachment.username || "A member") + " was removed by the room owner." });
        this.sendUsers();
        socket.send(JSON.stringify({ type: "adminResult", ok: true, text: "Member removed." }));
        return;
      }

      if (action === "mute" || action === "unmute") {
        targetAttachment.muted = action === "mute";
        targetSocket.serializeAttachment(targetAttachment);
        targetSocket.send(JSON.stringify({
          type: "notice",
          text: action === "mute" ? "The room owner muted you." : "The room owner unmuted you."
        }));
        this.sendUsers();
        socket.send(JSON.stringify({
          type: "adminResult",
          ok: true,
          text: action === "mute" ? "Member muted." : "Member unmuted."
        }));
      }
    }
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
    try { socket.close(); } catch {}
    this.sendUsers();
  }

  broadcast(data, except = null) {
    const payload = JSON.stringify(data);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      } catch {}
    }
  }

  sendUsers() {
    const users = this.ctx.getWebSockets()
      .filter(socket => socket.readyState === WebSocket.OPEN)
      .map(socket => {
        const a = socket.deserializeAttachment() || {};
        return {
          id: a.peerId,
          username: a.username || "Guest",
          muted: !!a.muted
        };
      });
    this.broadcast({ type: "users", users });
  }
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MR UNKNOWN'S CHAT PARADISE</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Arial,sans-serif;color:#fff;min-height:100vh;background:linear-gradient(rgba(0,0,0,.72),rgba(0,0,0,.88)),url("https://i.ibb.co/SDCt8Vsq/3b80d00a-f405-45d7-96d8-1f391222bb8c.png") center/cover fixed}
header{text-align:center;background:rgba(0,0,0,.92);padding:22px;border-bottom:2px solid #b00000}
header h1{color:#ff2020;font-size:clamp(23px,5vw,38px);text-shadow:0 0 15px red;margin:0}
header p{color:#ddd;letter-spacing:3px;font-size:12px}
nav{background:#160000;display:flex;justify-content:center;flex-wrap:wrap;border-bottom:1px solid #700}
nav button{background:none;border:0;color:white;padding:14px 18px;cursor:pointer;font-weight:bold}
nav button:hover{background:#750000}
.container{max-width:1250px;margin:25px auto;padding:15px}
.panel{background:rgba(0,0,0,.92);border:1px solid #8b0000;border-radius:9px;padding:18px;box-shadow:0 0 18px #6004}
h2{color:#ff3030;margin-top:0}
.login{max-width:430px;margin:35px auto;text-align:center}
input{width:100%;padding:13px;margin:8px 0;background:#171717;border:1px solid #700;border-radius:5px;color:white}
.btn{background:#a00000;color:white;border:1px solid #f33;padding:11px 16px;border-radius:5px;cursor:pointer;font-weight:bold;margin:4px}
.btn:hover{background:#e00000}
.btn:disabled{opacity:.45;cursor:not-allowed}
.small{color:#aaa;font-size:12px}
.hidden{display:none!important}
.dashboard{display:grid;grid-template-columns:210px minmax(280px,1fr) 190px;gap:14px;margin-top:18px}
.room{background:#171010;border:1px solid #500;padding:13px;margin:9px 0;border-radius:5px;cursor:pointer}
.room:hover,.room.active{background:#610000;border-color:red}
.chat-area{height:390px;overflow-y:auto;background:#101010;padding:14px;border:1px solid #500;border-radius:5px}
.message{padding:9px;border-bottom:1px solid #292020;overflow-wrap:anywhere}
.message strong{color:#ff4444}
.users{color:#ddd;font-size:14px}
.status{color:#00dd77;margin:9px 0}
.video-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px}
.video-tile{background:#111;border:1px solid #700;padding:8px;border-radius:6px;min-height:130px}
.video-tile video{width:100%;max-height:220px;background:#000}
.video-tile p{margin:5px;color:#ddd;font-size:13px}
footer{text-align:center;padding:25px;color:#aaa;font-size:12px}
@media(max-width:800px){.dashboard{grid-template-columns:1fr}nav button{padding:12px 9px;font-size:12px}}
</style>
</head>
<body>
<header><h1>MR UNKNOWN'S CHAT PARADISE</h1><p>WHERE STRANGERS BECOME FRIENDS</p></header>
<nav>
<button onclick="showSection('home')">HOME</button>
<button onclick="showSection('rooms')">CHATROOMS</button>
<button onclick="showSection('media')">WEBCAM & MIC</button>
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
<h2>THE CHATROOM LOUNGE</h2><p>Choose a room to explore.</p>
<div class="dashboard">
<div class="panel"><h2>CHATROOMS</h2><div id="roomList"></div></div>
<div class="panel">
<h2 id="roomTitle">Welcome Lounge</h2>
<div class="chat-area" id="messages"></div>
<input id="chatInput" maxlength="500" placeholder="Type your message..." onkeydown="if(event.key==='Enter')sendMessage()">
<button class="btn" onclick="sendMessage()">SEND MESSAGE</button>
<p class="small" id="connection">Not connected</p>
<div class="video-grid" id="videoGrid"></div>
</div>
<div class="panel"><h2>MEMBERS</h2><div class="users" id="memberList"></div></div>
</div>
</section>

<section id="media" class="panel hidden">
<h2>WEBCAM & MICROPHONE</h2>
<p>Start your camera and microphone to share live audio and video with people in your current room.</p>
<button class="btn" id="mediaStart" onclick="startMedia()">START WEBCAM & MIC</button>
<button class="btn" onclick="stopMedia()">STOP WEBCAM & MIC</button>
<p class="small" id="mediaStatus">Camera and microphone are off.</p>
<div class="video-grid" id="localVideoGrid"></div>
<p class="small">Your browser will ask permission. Use HTTPS and allow camera/microphone access. Video calls use a peer-to-peer connection; some networks may require a TURN service for reliable connections.</p>
</section>

<section id="admin" class="panel hidden">
<h2>ADMIN CONTROL PANEL</h2>
<p>Owner-only room controls.</p>
<div id="adminLogin">
<input id="ownerSecret" type="password" autocomplete="current-password" placeholder="Owner password">
<button class="btn" onclick="adminLogin()">OWNER LOGIN</button>
<p class="small">The owner password is checked by the server and is not displayed on the page.</p>
</div>
<div id="adminControls" class="hidden">
<p id="adminStatus" class="small">Owner controls are ready for this room.</p>
<div id="adminMembers"></div>
<button class="btn" onclick="adminAction('clear')">CLEAR THIS ROOM'S MESSAGES</button>
<button class="btn" onclick="adminLogout()">LOG OUT</button>
</div>
</section>
</main>
<footer>MR UNKNOWN'S CHAT PARADISE<br>© 2026 - ALL RIGHTS RESERVED</footer>

<script>
let currentUser="",currentRoom="Welcome Lounge",socket=null,peerId=null;
let localStream=null,ownerSecret="",members=[],peerConnections=new Map();
const roomNames=["Welcome Lounge","General Chat","Music Lounge","Horror Movie Zone","Country Corner","Private Hangout","Members Lounge"];
const rtcConfig={iceServers:[{urls:"stun:stun.l.google.com:19302"}]};

function showSection(id){
["home","rooms","media","admin"].forEach(name=>document.getElementById(name).classList.add("hidden"));
document.getElementById(id).classList.remove("hidden");
}
function enterChat(){
const name=document.getElementById("username").value.trim();
if(!name){alert("Please choose your username!");return;}
currentUser=name.slice(0,24);buildRooms();showSection("rooms");selectRoom("Welcome Lounge");
}
function buildRooms(){
const list=document.getElementById("roomList");list.replaceChildren();
roomNames.forEach(room=>{
const item=document.createElement("div");item.className="room";
const label=document.createElement("strong");label.textContent=room;item.appendChild(label);
item.appendChild(document.createElement("br"));
const small=document.createElement("span");small.className="small";small.textContent="Chatroom";item.appendChild(small);
item.onclick=()=>selectRoom(room);list.appendChild(item);
});
}
function addMessage(username,text,time){
const line=document.createElement("div");line.className="message";
const name=document.createElement("strong");name.textContent=username+": ";line.appendChild(name);
line.appendChild(document.createTextNode(text));
if(time){const stamp=document.createElement("span");stamp.className="small";stamp.textContent="  "+new Date(time).toLocaleTimeString();line.appendChild(stamp);}
const box=document.getElementById("messages");box.appendChild(line);box.scrollTop=box.scrollHeight;
}
function selectRoom(room){
currentRoom=room;document.getElementById("roomTitle").textContent=room;
document.getElementById("messages").replaceChildren();document.getElementById("memberList").replaceChildren();
document.getElementById("videoGrid").replaceChildren();
document.querySelectorAll("#roomList .room").forEach((item,index)=>item.classList.toggle("active",roomNames[index]===room));
closePeers();
if(socket){socket.onclose=null;socket.close();socket=null;}
connectRoom();
}
function connectRoom(){
const protocol=location.protocol==="https:"?"wss:":"ws:";
const url=protocol+"//"+location.host+"/ws?room="+encodeURIComponent(currentRoom)+"&username="+encodeURIComponent(currentUser);
socket=new WebSocket(url);
socket.onopen=()=>document.getElementById("connection").textContent="● Connected to "+currentRoom;
socket.onmessage=event=>{
let data;try{data=JSON.parse(event.data);}catch{return;}
if(data.type==="welcome"){
peerId=data.peerId;document.getElementById("messages").replaceChildren();
(data.messages||[]).forEach(m=>addMessage(m.username,m.text,m.time));
}
if(data.type==="message")addMessage(data.message.username,data.message.text,data.message.time);
if(data.type==="notice")addMessage("SYSTEM",data.text);
if(data.type==="clear")document.getElementById("messages").replaceChildren();
if(data.type==="users"){members=data.users||[];renderMembers();updatePeerConnections();}
if(data.type==="signal")handleSignal(data.from,data.signal);
if(data.type==="kicked"){alert(data.text);stopMedia();closePeers();showSection("home");}
if(data.type==="adminResult"){
document.getElementById("adminStatus").textContent=data.text;
if(data.ok){document.getElementById("adminLogin").classList.add("hidden");document.getElementById("adminControls").classList.remove("hidden");renderAdminMembers();}
else{document.getElementById("adminLogin").classList.remove("hidden");document.getElementById("adminControls").classList.add("hidden");ownerSecret="";document.getElementById("ownerSecret").value="";}
}
};
socket.onclose=()=>{document.getElementById("connection").textContent="Disconnected";};
socket.onerror=()=>{document.getElementById("connection").textContent="Connection error";};
}
function sendMessage(){
const input=document.getElementById("chatInput"),message=input.value.trim();
if(!message||!socket||socket.readyState!==WebSocket.OPEN)return;
socket.send(JSON.stringify({type:"message",text:message}));input.value="";
}
function renderMembers(){
const list=document.getElementById("memberList");list.replaceChildren();
members.forEach(member=>{
const line=document.createElement("p");line.className="status";
line.textContent="● "+member.username+(member.muted?" (muted)":"");
list.appendChild(line);
});
renderAdminMembers();
}
function sendSignal(target,signal){
if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"signal",target,signal}));
}
function closePeers(){
for(const pc of peerConnections.values())pc.close();
peerConnections.clear();
document.getElementById("videoGrid").replaceChildren();
}
function makePeer(member){
const pc=new RTCPeerConnection(rtcConfig);peerConnections.set(member.id,pc);
if(localStream)localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
pc.onicecandidate=e=>{if(e.candidate)sendSignal(member.id,{candidate:e.candidate});};
pc.ontrack=e=>showRemoteVideo(member.id,member.username,e.streams[0]);
pc.onconnectionstatechange=()=>{if(["failed","closed","disconnected"].includes(pc.connectionState))removeRemoteVideo(member.id);};
return pc;
}
async function updatePeerConnections(){
if(!peerId)return;
const active=new Set(members.filter(m=>m.id!==peerId).map(m=>m.id));
for(const [id,pc] of peerConnections){if(!active.has(id)){pc.close();peerConnections.delete(id);removeRemoteVideo(id);}}
for(const member of members){
if(member.id===peerId||peerConnections.has(member.id))continue;
const pc=makePeer(member);
if(peerId<member.id){
try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);sendSignal(member.id,{description:pc.localDescription});}catch(e){console.error(e);}
}
}
}
function showRemoteVideo(id,name,stream){
let tile=document.getElementById("peer-"+id);
if(!tile){tile=document.createElement("div");tile.className="video-tile";tile.id="peer-"+id;
const video=document.createElement("video");video.autoplay=true;video.playsInline=true;
const label=document.createElement("p");label.textContent=name;tile.append(video,label);document.getElementById("videoGrid").appendChild(tile);}
tile.querySelector("video").srcObject=stream;
}
function removeRemoteVideo(id){const tile=document.getElementById("peer-"+id);if(tile)tile.remove();}
async function handleSignal(from,signal){
let pc=peerConnections.get(from);
const member=members.find(m=>m.id===from)||{id:from,username:"Member"};
if(!pc)pc=makePeer(member);
try{
if(signal.description){
await pc.setRemoteDescription(signal.description);
if(signal.description.type==="offer"){
const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
sendSignal(from,{description:pc.localDescription});
}
}else if(signal.candidate){await pc.addIceCandidate(signal.candidate);}
}catch(e){console.error("WebRTC signaling error",e);}
}
async function startMedia(){
if(!currentUser||!socket||socket.readyState!==WebSocket.OPEN){alert("Enter a chatroom first.");return;}
try{
localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
const grid=document.getElementById("localVideoGrid");grid.replaceChildren();
const tile=document.createElement("div");tile.className="video-tile";
const video=document.createElement("video");video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=localStream;
const label=document.createElement("p");label.textContent=currentUser+" (you)";
tile.append(video,label);grid.appendChild(tile);
document.getElementById("mediaStatus").textContent="Your webcam and microphone are on in "+currentRoom+".";
for(const [id,pc] of peerConnections){
for(const track of localStream.getTracks()){
try{pc.addTrack(track,localStream);}catch{}
}
try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);sendSignal(id,{description:pc.localDescription});}catch(err){console.error("Could not start media connection",err);}
}
}catch(e){document.getElementById("mediaStatus").textContent="Could not start camera/microphone. Check browser permissions and device settings.";alert("Camera or microphone permission was not granted, or a device is unavailable.");}
}
function stopMedia(){
if(localStream){localStream.getTracks().forEach(track=>track.stop());localStream=null;}
document.getElementById("localVideoGrid").replaceChildren();
document.getElementById("mediaStatus").textContent="Camera and microphone are off.";
closePeers();if(peerId)updatePeerConnections();
}
function adminLogin(){
ownerSecret=document.getElementById("ownerSecret").value;
if(!ownerSecret){alert("Enter the owner password.");return;}
if(!socket||socket.readyState!==WebSocket.OPEN){document.getElementById("adminStatus").textContent="Connect to a chatroom before logging in.";return;}
document.getElementById("adminStatus").textContent="Checking owner password...";
socket.send(JSON.stringify({type:"admin",secret:ownerSecret,action:"login"}));
}
function adminLogout(){
ownerSecret="";document.getElementById("ownerSecret").value="";
document.getElementById("adminControls").classList.add("hidden");
document.getElementById("adminLogin").classList.remove("hidden");
}
function adminSend(action,target){
if(!socket||socket.readyState!==WebSocket.OPEN){alert("Connect to a chatroom first.");return;}
socket.send(JSON.stringify({type:"admin",secret:ownerSecret,action,target}));
}
function adminAction(action){if(action==="clear"&&!confirm("Clear all saved messages in this room?"))return;adminSend(action);}
function renderAdminMembers(){
const box=document.getElementById("adminMembers");if(!box)return;box.replaceChildren();
if(!ownerSecret)return;
members.filter(m=>m.id!==peerId).forEach(member=>{
const row=document.createElement("div");row.className="room";
const name=document.createElement("strong");name.textContent=member.username;row.appendChild(name);
const kick=document.createElement("button");kick.className="btn";kick.textContent="KICK";kick.onclick=()=>{if(confirm("Remove "+member.username+" from this room?"))adminSend("kick",member.id);};
const mute=document.createElement("button");mute.className="btn";mute.textContent=member.muted?"UNMUTE":"MUTE";mute.onclick=()=>adminSend(member.muted?"unmute":"mute",member.id);
row.append(kick,mute);box.appendChild(row);
});
}
window.addEventListener("beforeunload",()=>{stopMedia();if(socket)socket.close();});
</script>
</body>
</html>`;
