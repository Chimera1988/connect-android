const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const ts=require('typescript');

function harness(){
  const states=[],refs=[];
  let stateIndex=0,refIndex=0,context=null;
  const createElement=(type,props,...children)=>({type,props:props||{},children:children.flat()});
  const react={createElement,createContext:()=>({Provider:'ContextProvider'}),useContext:()=>context,
    useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=value;}];},
    useRef(initial){const index=refIndex++;return refs[index] ||= {current:initial};},useMemo:fn=>fn(),useEffect(){}};
  const native={View:'View',Platform:{OS:'android'},AccessibilityInfo:{},StyleSheet:{absoluteFill:{position:'absolute',top:0,bottom:0,left:0,right:0},flatten:style=>style}};
  const stubs={'react':react,'react-native':native,'expo-blur':{BlurTargetView:'BlurTargetView',BlurView:'BlurView'},'./ConnectNativeGlass':{glassColor:(_color,alpha)=>'tint:'+alpha}};
  const code=ts.transpileModule(readFileSync(path.join(__dirname,'../src/ConnectNativeGlassPanel.tsx'),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true},
  }).outputText;
  const exports={};
  vm.runInNewContext(code,{exports,require:name=>{assert.ok(name in stubs,name);return stubs[name];}},{filename:'ConnectNativeGlassPanel.js'});
  return {
    provider(props){stateIndex=0;refIndex=0;const tree=exports.ConnectNativeGlassProvider(props);context=tree.props.value;return tree;},
    panel:props=>exports.default(props),
    setContext:value=>{context=value;},
  };
}
const colors={bg:'#070c15',surface:'#112233',text:'#ffffff'};
const nativeBlur=tree=>tree.children.find(child=>child&&child.type==='BlurView');

test('native blur waits for target layout and uses the actual Expo58 target ref',()=>{
  const h=harness(),backdrop={type:'Scene'},foreground={type:'Dock'};
  let tree=h.provider({backdrop,children:foreground});
  assert.equal(nativeBlur(h.panel({colors})),undefined);
  const root=tree.children[0],target=root.children[0];
  assert.equal(target.type,'BlurTargetView');
  assert.equal(target.children[0],backdrop);
  assert.equal(root.children[1],foreground); // Blur children cannot capture themselves.
  target.props.ref.current={nativeTag:7};
  target.props.onLayout();
  tree=h.provider({backdrop,children:foreground});
  const blur=nativeBlur(h.panel({colors}));
  assert.equal(blur.props.blurTarget,tree.props.value.target);
  assert.equal(blur.props.blurTarget.current.nativeTag,7);
  assert.equal(blur.props.blurMethod,'dimezisBlurViewSdk31Plus');
  assert.equal(blur.props.experimentalBlurMethod,undefined);
  assert.equal(blur.props.blurReductionFactor,2);
  assert.equal(blur.props.tint,'dark');
});

test('minimal scene and reduced transparency use solid surfaces without BlurView',()=>{
  const h=harness();
  for(const config of [{enabled:false,reducedTransparency:false},{enabled:true,reducedTransparency:true}]){
    h.setContext({ready:true,target:{current:{}},...config});
    const panel=h.panel({colors});
    assert.equal(nativeBlur(panel),undefined);
    assert.equal(panel.props.style.at(-1).backgroundColor,colors.surface);
  }
});

test('panel preserves layout, accessibility and children while keeping tint behind foreground',()=>{
  const h=harness();
  h.setContext({ready:true,enabled:true,reducedTransparency:false,target:{current:{}}});
  const child={type:'Button'},style={flexDirection:'row',padding:6,borderRadius:25,backgroundColor:'#000000'};
  const panel=h.panel({colors,style,children:child,accessibilityLabel:'Navigation',intensity:1000});
  assert.equal(panel.props.style[0],style);
  assert.equal(panel.props.style.at(-1).backgroundColor,'transparent');
  assert.equal(panel.props.style.at(-1).overflow,'hidden');
  assert.equal(panel.props.accessibilityLabel,'Navigation');
  assert.equal(panel.children.at(-1),child);
  assert.equal(nativeBlur(panel).props.intensity,100);
});

test('panels without a provider render a readable translucent fallback',()=>{
  const h=harness(),panel=h.panel({colors});
  assert.equal(nativeBlur(panel),undefined);
  assert.equal(panel.children.find(child=>child?.type==='View').props.style.at(-1).backgroundColor,'tint:0.85');
});

test('light palettes select light native blur tint',()=>{
  const h=harness();
  h.setContext({ready:true,enabled:true,reducedTransparency:false,target:{current:{}}});
  assert.equal(nativeBlur(h.panel({colors:{...colors,bg:'#edf3fa'}})).props.tint,'light');
});
