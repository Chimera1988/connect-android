/** Offline, native SVG port of Connect PWA's "Если скучно" runner.
 * Same rules, acceleration, obstacle types, ring scoring and local best score.
 * All drawing is local; no WebView, internet connection or new permissions.
 */
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {AppState,Modal,Pressable,ScrollView,Text,View} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Svg,{Defs,Ellipse,G,LinearGradient,Rect,Stop} from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import type {Palette} from './theme';

type EnemyKind='motobug'|'crabmeat'|'buzzbomber';
type Enemy={id:number;kind:EnemyKind;x:number;w:number;h:number;altitude:number};
type Ring={id:number;x:number;y:number;taken:boolean};
type Mode='ready'|'running'|'over';
type Game={elapsed:number;score:number;ringsCollected:number;speed:number;jumpOffset:number;jumpVelocity:number;nextObstacle:number;enemies:Enemy[];rings:Ring[];nextId:number};
const W=360,H=320,GROUND=H-59,PLAYER_X=57;
const BEST_KEY='connect-sonic-runner-best-v1';
const fresh=():Game=>({elapsed:0,score:0,ringsCollected:0,speed:175,jumpOffset:0,jumpVelocity:0,nextObstacle:1.35,enemies:[],rings:[],nextId:1});
function heightOf(enemy:Enemy,seconds:number){return enemy.kind==='buzzbomber'?enemy.altitude+Math.sin(seconds*5.2+enemy.id)*2.5:0;}
function SpritePixel({x,y,w,h,color,scale=2.05}:{x:number;y:number;w:number;h:number;color:string;scale?:number}){
  return <Rect x={Math.round(x*scale)} y={Math.round(y*scale)} width={Math.round(w*scale)} height={Math.round(h*scale)} fill={color}/>;
}
function RunnerSprite({jump,tick}:{jump:number;tick:number}){
  const run=jump < -6 ? 0 : (Math.floor(tick*12)%2)*2;
  const p=(x:number,y:number,w:number,h:number,color:string,key:string)=><SpritePixel key={key} x={x} y={y} w={w} h={h} color={color}/>;
  const B='#1468ea',D='#0843a7',I='#52b3ff',S='#f0ad73',W='#f9f5e8',R='#e22e3c';
  return <G transform={`translate(${PLAYER_X} ${GROUND+jump-57})`}>
    {p(1,9,10,4,D,'a')}{p(3,6,12,4,B,'b')}{p(0,13,12,3,B,'c')}{p(6,3,12,4,B,'d')}
    {p(10,1,9,4,D,'e')}{p(15,4,7,5,B,'f')}{p(18,8,5,8,B,'g')}{p(4,11,18,9,B,'h')}
    {p(9,16,13,6,S,'i')}{p(14,7,5,9,W,'j')}{p(17,9,2,6,'#19885b','k')}
    {p(18,11,1.5,4,'#102a3e','l')}{p(19,17,3,2,'#181822','m')}{p(8,21,12,3,B,'n')}
    {p(4,22,6,5,W,'o')}{p(16,22,5,5,W,'q')}
    {p(7+run,24,6,4,B,'r')}{p(15-run,24,5,4,B,'s')}
    {p(4+run,27,11,2,R,'t')}{p(12-run,28,11,2,R,'u')}
    {p(4+run,28,11,1,'#f9f9ff','v')}{p(12-run,29,11,1,'#f9f9ff','w')}
    {p(5+run,26,6,1,'#f9f9ff','x')}{p(13-run,27,6,1,'#f9f9ff','y')}{p(9,4,7,2,I,'z')}
  </G>;
}
function EnemySprite({enemy,time}:{enemy:Enemy;time:number}){
  const y=GROUND-enemy.h-heightOf(enemy,time);
  const P=(x:number,y:number,w:number,h:number,color:string,key:string)=><Rect key={key} x={x*2.1} y={y*2.1} width={w*2.1} height={h*2.1} fill={color}/>;
  const move=Math.floor(time*7)%2;
  return <G>
    <Rect x={enemy.x+5} y={GROUND+1} width={Math.max(12,enemy.w-9)} height={3} fill="#28363755"/>
    <G transform={`translate(${enemy.x} ${y})`}>
      {enemy.kind==='motobug'?<>
        {P(1,8,14,7,'#b7192f','1')}{P(3,5,10,4,'#ef3946','2')}{P(5,3,6,2,'#ff6871','3')}
        {P(13,9,4,4,'#c8d9ec','4')}{P(14,10,2,2,'#1b222e','5')}{P(3,15,4,4,'#273d58','6')}
        {P(11,15,4,4,'#273d58','7')}{P(4,16,2,2,'#91aec9','8')}{P(12,16,2,2,'#91aec9','9')}
      </>:enemy.kind==='crabmeat'?<>
        {P(4,10,11,7,'#e93e3d','1')}{P(5,7,9,4,'#ff7360','2')}{P(6,6,2,4,'#f3f7fa','3')}
        {P(11,6,2,4,'#f3f7fa','4')}{P(6,8,1,2,'#17293c','5')}{P(11,8,1,2,'#17293c','6')}
        {P(1,4,2,8,'#d92638','7')}{P(16,4,2,8,'#d92638','8')}{P(0,3,4,5,'#ff5a48','9')}
        {P(15,3,4,5,'#ff5a48','10')}{P(2,18+move,3,2,'#647f9c','11')}{P(13,18-move,3,2,'#647f9c','12')}
      </>:<>
        {P(4,8,12,8,'#e8b735','1')}{P(3,9,3,6,'#2d3948','2')}{P(10,9,3,6,'#222c40','3')}
        {P(15,10,4,5,'#d3e9ef','4')}{P(16,11,2,2,'#c72e3a','5')}{P(6,3-move,5,6,'#9fd6f4','6')}
        {P(10,4+move,5,5,'#b9e7fb','7')}{P(1,13,4,2,'#58718d','8')}{P(9,16,2,4,'#343d4e','9')}{P(8,20,4,2,'#e33c48','10')}
      </>}
    </G>
  </G>;
}
function Scene({game,mode}:{game:Game;mode:Mode}){
  const offset=(game.elapsed*game.speed*.75)%40;
  const checker=[] as React.ReactNode[];
  for(let col=-2;col<21;col++)for(let row=0;row<4;row++){
    checker.push(<Rect key={`${col}:${row}`} x={col*20-offset} y={GROUND+5+row*20} width={20} height={20} fill={(col+row)%2?'#ba7637':'#9e622d'}/>);
  }
  const cloudShift=(game.elapsed*13)%175;
  const hillShift=(game.elapsed*19)%190;
  return <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
    <Defs><LinearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%"><Stop offset="0" stopColor="#73d4fa"/><Stop offset="0.67" stopColor="#a5f0fc"/><Stop offset="1" stopColor="#d6f9d3"/></LinearGradient></Defs>
    <Rect x={0} y={0} width={W} height={H} fill="url(#sky)"/>
    {[24,68,112,156].map(y=><Rect key={y} x={0} y={y} width={W} height={2} fill="#ffffff22"/>)}
    {[-190,0,190,380].map(x=><G key={x} transform={`translate(${x-hillShift} 0)`}>
      <Ellipse cx={88} cy={GROUND+50} rx={95} ry={94} fill="#8ccd89"/>
      <Ellipse cx={157} cy={GROUND+56} rx={78} ry={67} fill="#74b675"/>
    </G>)}
    {[-175,0,175,350,525].map(x=><G key={x} transform={`translate(${x-cloudShift} 0)`}>
      <Rect x={35} y={52} width={92} height={13} rx={7} fill="#f4ffffcf"/>
      <Rect x={49} y={37} width={61} height={21} rx={11} fill="#f4ffffe8"/>
      <Rect x={67} y={28} width={29} height={19} rx={10} fill="#ffffffd6"/>
    </G>)}
    <Rect x={0} y={GROUND+4} width={W} height={H-GROUND} fill="#87552a"/>
    {checker}
    <Rect x={0} y={GROUND-6} width={W} height={10} fill="#28b54d"/>
    <Rect x={0} y={GROUND-8} width={W} height={3} fill="#83e75f"/>
    {game.rings.filter(r=>!r.taken).map(r=><G key={r.id} transform={`translate(${r.x} ${r.y}) scale(${.65+Math.abs(Math.sin(game.elapsed*6))*.35} 1)`}>
      <Ellipse cx={0} cy={0} rx={8} ry={10} fill="none" stroke="#8e5604" strokeWidth={4}/>
      <Ellipse cx={0} cy={0} rx={7} ry={9} fill="none" stroke="#ffd83b" strokeWidth={3}/>
      <Rect x={-2} y={-10} width={4} height={3} fill="#fff6a8"/>
    </G>)}
    {game.enemies.map(e=><EnemySprite key={e.id} enemy={e} time={game.elapsed}/>)}
    <Rect x={PLAYER_X+13} y={GROUND+1} width={32} height={3} fill="#182c3155"/>
    <RunnerSprite jump={game.jumpOffset} tick={game.elapsed}/>
    {mode==='ready'&&<Rect x={0} y={0} width={W} height={H} fill="#09203811"/>}
  </Svg>;
}
export default function ConnectNativeSonicRunner({visible,onClose,colors}:{visible:boolean;onClose:()=>void;colors:Palette}){
  const game=useRef<Game>(fresh());
  const modeRef=useRef<Mode>('ready');
  const bestRef=useRef(0);
  const lastHud=useRef(0);
  const [mode,setMode]=useState<Mode>('ready');
  const [frame,setFrame]=useState<Game>(fresh());
  const [score,setScore]=useState(0),[rings,setRings]=useState(0),[best,setBest]=useState(0);
  const finish=useCallback(()=>{
    if(modeRef.current!=='running')return;
    modeRef.current='over';setMode('over');
    const g=game.current;
    setScore(g.score);setRings(g.ringsCollected);
    if(g.score>bestRef.current){
      bestRef.current=g.score;setBest(g.score);
      void SecureStore.setItemAsync(BEST_KEY,String(g.score)).catch(()=>{});
    }
  },[]);
  const start=useCallback(()=>{
    game.current=fresh();modeRef.current='running';setMode('running');setScore(0);setRings(0);lastHud.current=0;
  },[]);
  const jump=useCallback(()=>{
    if(modeRef.current!=='running'){start();return;}
    const g=game.current;
    if(g.jumpOffset>=-2&&g.jumpVelocity>=0)g.jumpVelocity=-580;
  },[start]);
  useEffect(()=>{
    if(!visible)return;
    let alive=true;
    game.current=fresh();modeRef.current='ready';setMode('ready');setFrame(fresh());setScore(0);setRings(0);
    void SecureStore.getItemAsync(BEST_KEY).then(v=>{
      if(!alive)return;
      const value=Math.max(0,Math.floor(Number(v)||0));bestRef.current=value;setBest(value);
    }).catch(()=>{});
    return()=>{alive=false;modeRef.current='ready';};
  },[visible]);
  useEffect(()=>{
    if(!visible)return;
    let previous=Date.now();
    const timer=setInterval(()=>{
      const now=Date.now();const dt=Math.min((now-previous)/1000,.034);previous=now;
      const g=game.current;
      if(modeRef.current==='running'&&AppState.currentState==='active'){
        g.elapsed+=dt;g.speed=Math.min(355,175+g.elapsed*4.5);
        g.jumpVelocity+=1620*dt;g.jumpOffset=Math.min(0,g.jumpOffset+g.jumpVelocity*dt);
        if(g.jumpOffset===0&&g.jumpVelocity>0)g.jumpVelocity=0;
        g.nextObstacle-=dt;
        if(g.nextObstacle<=0){
          const types:EnemyKind[]=['motobug','crabmeat','buzzbomber'];
          const kind=types[Math.floor(Math.random()*types.length)];
          const altitude=kind==='buzzbomber'?(g.elapsed>10&&Math.random()>.5?75:18):0;
          g.enemies.push({id:g.nextId++,kind,x:W+40,w:kind==='crabmeat'?43:39,h:kind==='buzzbomber'?47:42,altitude});
          if(Math.random()>.22)g.rings.push({id:g.nextId++,x:W+56,y:GROUND-100,taken:false});
          g.nextObstacle=Math.max(.98,1.55+Math.random()*.68-g.elapsed*.005);
        }
        for(const e of g.enemies)e.x-=g.speed*dt;
        for(const r of g.rings)r.x-=g.speed*dt;
        g.enemies=g.enemies.filter(e=>e.x+e.w>-8);
        g.rings=g.rings.filter(r=>r.x>-20&&!r.taken);
        const left=PLAYER_X+10,right=PLAYER_X+45,top=GROUND-48+g.jumpOffset,bottom=GROUND+g.jumpOffset-4;
        for(const e of g.enemies){
          const foeBottom=GROUND-heightOf(e,g.elapsed),foeTop=foeBottom-e.h;
          if(right>e.x+5&&left<e.x+e.w-5&&bottom>foeTop+5&&top<foeBottom-5){finish();break;}
        }
        if(modeRef.current==='running')for(const r of g.rings){
          if(r.x>=left-8&&r.x<=right+8&&r.y>=top-14&&r.y<=bottom+9){r.taken=true;g.ringsCollected++;}
        }
        g.score=Math.floor(g.elapsed*15+g.ringsCollected*25);
        if(now-lastHud.current>110){lastHud.current=now;setScore(g.score);setRings(g.ringsCollected);}
      }
      setFrame({...g,enemies:[...g.enemies],rings:[...g.rings]});
    },34);
    return()=>clearInterval(timer);
  },[visible,finish]);
  const panel={backgroundColor:colors.surface,borderColor:colors.line,borderWidth:1,borderRadius:15,padding:10,flex:1,alignItems:'center' as const};
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <ScrollView style={{flex:1,backgroundColor:colors.bg}} contentContainerStyle={{padding:15,paddingTop:35,paddingBottom:35,gap:12}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
        <Text style={{color:colors.text,fontSize:25,fontWeight:'800'}}>Если скучно 🎮</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть игру" onPress={onClose} style={{padding:9,borderRadius:12,backgroundColor:colors.elevated}}><Ionicons name="close" size={22} color={colors.accent}/></Pressable>
      </View>
      <Text style={{color:colors.muted,fontSize:12}}>Пиксельный Соник против роботов доктора Эггмана</Text>
      <View style={{flexDirection:'row',gap:8}}>
        <View style={panel}><Text style={{color:colors.text,fontSize:21,fontWeight:'800'}}>{score}</Text><Text style={{color:colors.muted,fontSize:11}}>Очки</Text></View>
        <View style={panel}><Text style={{color:colors.text,fontSize:21,fontWeight:'800'}}>{rings} ◉</Text><Text style={{color:colors.muted,fontSize:11}}>Кольца</Text></View>
        <View style={panel}><Text style={{color:colors.text,fontSize:21,fontWeight:'800'}}>{best}</Text><Text style={{color:colors.muted,fontSize:11}}>Рекорд</Text></View>
      </View>
      <Pressable onPress={jump} accessibilityRole="button" accessibilityLabel="Прыжок или начало игры" style={{height:320,borderWidth:2,borderColor:colors.accent,borderRadius:19,overflow:'hidden',backgroundColor:'#76d5f8'}}>
        <Scene game={frame} mode={mode}/>
        {mode!=='running'&&<View pointerEvents="none" style={{position:'absolute',left:'9%',right:'9%',top:'36%',padding:14,borderRadius:15,backgroundColor:'#092345dd',borderColor:'#e1f5ff',borderWidth:1,alignItems:'center',gap:6}}>
          <Text style={{color:'#fff',fontWeight:'800',fontSize:19}}>{mode==='over'?'Игра окончена!':'Готов к забегу?'}</Text>
          <Text style={{color:'#e6f5ff',fontSize:12,lineHeight:17,textAlign:'center'}}>{mode==='over'?`Счёт: ${score}. Ещё одну попытку?`:'Перепрыгивай наземных и низких роботов. Под высокими пробегай снизу! Собирай кольца.'}</Text>
        </View>}
      </Pressable>
      <View style={{flexDirection:'row',gap:9}}>
        <Pressable accessibilityRole="button" accessibilityLabel={mode==='running'?'Прыжок':'Начать забег'} onPress={mode==='running'?jump:start} style={{flex:1,padding:15,borderRadius:14,backgroundColor:colors.accent,alignItems:'center'}}><Text style={{fontWeight:'800',color:colors.bg}}>{mode==='running'?'↑ Прыжок':mode==='over'?'↻ Ещё раз':'▶ Начать'}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={{flex:1,padding:15,borderRadius:14,backgroundColor:colors.elevated,alignItems:'center'}}><Text style={{fontWeight:'700',color:colors.text}}>Вернуться</Text></Pressable>
      </View>
      <Text style={{color:colors.muted,textAlign:'center',fontSize:12,lineHeight:18}}>Касайся игрового поля, чтобы прыгать. Высоких летающих роботов пропускай над собой. Рекорд сохраняется на устройстве.</Text>
    </ScrollView>
  </Modal>;
}
