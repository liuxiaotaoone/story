import './style.css';
import farmerManifest from '../manifests/farmer.json' with {type: 'json'};
import rabbitManifest from '../manifests/rabbit.json' with {type: 'json'};

type Point = {x: number; y: number};
type Pose = {id: string; fps: number; frames: string[]};
type Manifest = {characterId: string; poses: Pose[]};
const manifests: Record<string, Manifest> = {farmer: farmerManifest, rabbit: rabbitManifest};
const anchorNames = ['foot','leftFoot','rightFoot','leftHand','rightHand','center','head'];
let selectedAnchor = 'foot';
let anchors: Record<string, Point> = {};
let frameIndex = 0;
let playing = true;
let timer = 0;

const select = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const manifestSelect = select<HTMLSelectElement>('#manifest');
const poseSelect = select<HTMLSelectElement>('#pose');
const image = select<HTMLImageElement>('#asset');
const stage = select<HTMLDivElement>('#stage');
const anchorLayer = select<HTMLDivElement>('#anchors');
const anchorJson = select<HTMLPreElement>('#anchor-json');

function currentManifest(): Manifest { return manifests[manifestSelect.value]!; }
function currentPose(): Pose { return currentManifest().poses.find(pose => pose.id === poseSelect.value)!; }

function renderAnchors(): void {
  anchorLayer.replaceChildren(...Object.entries(anchors).map(([name, point]) => {
    const marker = document.createElement('span');
    marker.className = 'anchor'; marker.dataset.name = name;
    marker.style.left = `${point.x * 100}%`; marker.style.top = `${point.y * 100}%`;
    return marker;
  }));
  anchorJson.textContent = JSON.stringify({assetId: image.dataset.assetId, anchors}, null, 2);
}

function setFrame(): void {
  const pose = currentPose();
  frameIndex %= Math.max(1, pose.frames.length);
  const frame = pose.frames[frameIndex]!;
  image.src = `/${frame}`;
  image.dataset.assetId = frame.split('/').at(-1)!.replace(/\.png$/,'');
  select('#frame-label').textContent = `${pose.id} · ${frameIndex + 1}/${pose.frames.length} · ${frame}`;
  anchors = {};
  renderAnchors();
}

image.addEventListener('load', () => {
  stage.style.aspectRatio = `${image.naturalWidth}/${image.naturalHeight}`;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (context === null) return;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left=canvas.width, top=canvas.height, right=0, bottom=0;
  for(let y=0;y<canvas.height;y+=1) for(let x=0;x<canvas.width;x+=1) if((pixels[(y*canvas.width+x)*4+3]??0)>8){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  const bbox=select<HTMLDivElement>('#bbox');
  if(right>left&&bottom>top){bbox.style.display='block';bbox.style.left=`${left/canvas.width*100}%`;bbox.style.top=`${top/canvas.height*100}%`;bbox.style.width=`${(right-left)/canvas.width*100}%`;bbox.style.height=`${(bottom-top)/canvas.height*100}%`;}
  else bbox.style.display='none';
});

function populatePoses(): void {
  poseSelect.replaceChildren(...currentManifest().poses.map(pose => new Option(pose.id, pose.id)));
  const pose = currentPose();
  select<HTMLInputElement>('#fps').value = String(Math.min(12, Math.max(4, pose.fps)));
  select('#fps-value').textContent = select<HTMLInputElement>('#fps').value;
  frameIndex = 0; setFrame(); restart();
}

function restart(): void {
  window.clearInterval(timer);
  const fps = Number(select<HTMLInputElement>('#fps').value);
  timer = window.setInterval(() => { if (playing && currentPose().frames.length > 1) { frameIndex += 1; setFrame(); } }, 1000 / fps);
}

for (const name of anchorNames) {
  const button = document.createElement('button'); button.textContent = name;
  button.addEventListener('click', () => { selectedAnchor = name; document.querySelectorAll('#anchor-buttons button').forEach(item => item.classList.toggle('active', item === button)); });
  select('#anchor-buttons').append(button);
  if (name === selectedAnchor) button.classList.add('active');
}
stage.addEventListener('click', event => {
  const bounds = stage.getBoundingClientRect();
  anchors[selectedAnchor] = {x: Number(((event.clientX-bounds.left)/bounds.width).toFixed(4)), y: Number(((event.clientY-bounds.top)/bounds.height).toFixed(4))};
  renderAnchors();
});
manifestSelect.addEventListener('change', populatePoses);
poseSelect.addEventListener('change', () => {frameIndex=0;setFrame();restart();});
select('#fps').addEventListener('input', () => {select('#fps-value').textContent=select<HTMLInputElement>('#fps').value;restart();});
select('#play').addEventListener('click', () => {playing=!playing;select('#play').textContent=playing?'Pause':'Play';});
select('#show-ground').addEventListener('change', event => {select<HTMLDivElement>('#ground').hidden=!(event.target as HTMLInputElement).checked;});
select('#show-bbox').addEventListener('change', event => {select<HTMLDivElement>('#bbox').hidden=!(event.target as HTMLInputElement).checked;});
select('#show-anchors').addEventListener('change', event => {anchorLayer.hidden=!(event.target as HTMLInputElement).checked;});
select('#download').addEventListener('click', () => {const link=document.createElement('a');link.download=`${image.dataset.assetId}.json`;link.href=URL.createObjectURL(new Blob([anchorJson.textContent??'{}'],{type:'application/json'}));link.click();URL.revokeObjectURL(link.href);});
populatePoses();
