const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const test=require('node:test');
const {wavesFromAccent,sceneBackground,mixSceneColor,SCENE_PATHS}=require('../src/ConnectNativeScene.ts');

const presets={
  '#087dff':['#17b8f8','#6b92ff','#94d9ff'],
  '#8055dc':['#a17afb','#7e9cf6','#d48df5'],
  '#dc477e':['#fa66ad','#b97af2','#ff9bba'],
  '#198f78':['#0ad9b7','#65acf4','#79f0d0'],
  '#b46b26':['#f4a951','#efbf7c','#fa8568'],
  '#cc4545':['#f26a72','#d865a7','#ffa293'],
  '#60748b':['#9db9ce','#7199c6','#b8cadc'],
};

test('all seven Connect PWA preset accents preserve their complete scene triads',()=>{
  for(const [accent,triad] of Object.entries(presets)){
    assert.deepEqual(wavesFromAccent(accent),triad);
    assert.deepEqual(wavesFromAccent('  '+accent.toUpperCase()+'  '),triad);
  }
});

test('custom accents use the PWA hue offsets, saturation bounds and rounded HSL values',()=>{
  const cases={
    '#123456':['#4a91d9','#8089db','#8ac7d6'],
    '#ff0000':['#f13232','#eba170','#e37d9c'],
    '#00ff00':['#32f132','#70eba1','#9ce37d'],
    '#0000ff':['#3232f1','#a170eb','#7d9ce3'],
    '#a96f83':['#d1527e','#d68985','#d28eba'],
    '#098142':['#32f18e','#70ebdc','#7de390'],
  };
  for(const [accent,triad] of Object.entries(cases))assert.deepEqual(wavesFromAccent(accent),triad,accent);
});

test('short, achromatic and invalid accents follow the PWA color fallback rules',()=>{
  // PWA assigns achromatic colors hue 0 and its minimum 58% saturation.
  const achromatic=['#d15252','#d6a585','#d28ea2'];
  for(const accent of ['#000','#fff','#000000','#ffffff','#777777'])assert.deepEqual(wavesFromAccent(accent),achromatic);
  assert.deepEqual(wavesFromAccent('#abc'),wavesFromAccent('#aabbcc'));
  for(const accent of ['', 'red','#12','#12345g','rgb(0,0,0)'])assert.deepEqual(wavesFromAccent(accent),presets['#087dff']);
});

test('scene backgrounds match the final PWA dark and light CSS rules',()=>{
  assert.equal(sceneBackground('waves','#087dff',false),'#070c15');
  assert.equal(sceneBackground('waves','#087dff',true),'#edf3fa');
  for(const scene of ['aurora','moon','sunset','lagoon','nebula']){
    assert.equal(sceneBackground(scene,'#087dff',false),'#091825');
    assert.equal(sceneBackground(scene,'#087dff',true),'#e6f3fc');
    assert.notEqual(sceneBackground(scene,'#087dff',false),sceneBackground(scene,'#dc477e',false));
  }
  assert.equal(sceneBackground('minimal','#087dff',false),'#0e1722');
  assert.equal(sceneBackground('minimal','#087dff',true),'#ecf4fa');
});

test('color mixing uses sRGB channels and preserves endpoints',()=>{
  assert.equal(mixSceneColor('#000000','#ffffff',.5),'#808080');
  assert.equal(mixSceneColor('#17b8f8','#94d9ff',1),'#17b8f8');
  assert.equal(mixSceneColor('#17b8f8','#94d9ff',0),'#94d9ff');
});

test('six scene geometries retain the original PWA path fixtures',()=>{
  // SHA-256 of the two distinct path d attributes joined with LF, captured
  // from PWA public/connect-wave-mask.svg and public/connect-scenes/*.svg
  // at df71ca06e615ca5f981ae9276bd3642587f76e1a.
  // Fixtures make this regression test independent of a second checkout.
  const fixtures={
    waves:'fb61291d7ef56c2499b37eb2b049f902723c0c46295b86d5135605aff9217cde',
    aurora:'bbf57f47acbd90fd30d300fa79b97cb9b8afb39f59985911ddbda9bc9d9a3fba',
    moon:'a6d7dd539c3a53eb656dfbbaa8b0cc42d20e7e68653bccb8c764a54635983b11',
    sunset:'da2323555358b9815d47dadd118570172a153287a4de90df73585859585e182f',
    lagoon:'2f4a9087850c47d869de51ce27cd85df9845d81d2152466ab306ea35693275cc',
    nebula:'2271e3401f604ef5896061b7775d082ff3edf7b46f38ef8211334dd10f42a8fa',
  };
  assert.deepEqual(Object.keys(SCENE_PATHS).sort(),Object.keys(fixtures).sort());
  assert.equal(new Set(Object.values(SCENE_PATHS).flat()).size,12);
  for(const [scene,digest] of Object.entries(fixtures))assert.equal(createHash('sha256').update(SCENE_PATHS[scene].join('\n')).digest('hex'),digest,scene);
});
