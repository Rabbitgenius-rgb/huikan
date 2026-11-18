// The frame numbers are at 24 fps. Transient gestures enter and leave the
// neutral pose shared with the idle animation.
module.exports = function gestures(idle, poses) {
  const neutral = {
    ...idle, swayX:0, swayY:0, swing:0, over:0,
    wave:0, rightWave:0, wink:0, mouth:0, joy:0, note:0, book:0, page:0, heart:0,
  };
  const action = keys => poses(neutral, [[0,{}],...keys]);
  return {
    blink: action([[3,{blink:1}],[7,neutral]]),
    curious: action([
      [8,{dx:-5,dy:-3,tilt:-9,lean:-4,lx:151,ly:330,rx:228,ry:310,over:.65}],
      [21,{dx:-4,dy:1,tilt:-8,lean:-2,ly:334,ry:307}],
      [27,{dx:1,dy:1,tilt:1,lean:0,ry:325,over:.2,blink:.6}], [36,neutral],
    ]),
    swim: action([
      [8,{swayX:-11,swayY:2,swing:-2.6,dx:-3,tilt:-3,belly:7}],
      [17,{swayX:9,swayY:-4,swing:3.5,dx:3,tilt:3,belly:-10,rx:239,ry:332}],
      [26,{swayX:12,swayY:-6,swing:-2.3,dx:-1,tilt:1,belly:8,rx:237,ry:335}],
      [35,{swayX:-4,swayY:-2,swing:1.2,tilt:-1,belly:-4,blink:.65}],
      [47,neutral],
    ]),
    stretch: action([
      [7,{dy:6,tilt:1.6,lean:1,swayY:2,ly:333,ry:333,blink:.35}],
      [18,{dy:-3,tilt:-3,lean:0,swayY:-1,lx:103,ly:262,rx:281,ry:253,over:1,blink:1,mouth:.4}],
      [29,{dy:-5,tilt:-4,swayY:-1,lx:97,ly:199,rx:292,ry:190,wave:.72,mouth:1}],
      [39,{dy:-5,tilt:-3,lx:97,ly:196,rx:290,ry:191,mouth:.87,belly:-1.7}],
      [50,{dy:-4,tilt:-2,lx:107,ly:202,rx:287,ry:192,wave:.5,mouth:.37}],
      [64,{dy:-1,tilt:1,swayY:-1,lx:109,ly:273,rx:275,ry:265,wave:0,mouth:0,blink:.7}],
      [74,{dx:1,dy:4,tilt:2,swayY:1,lean:1,lx:144,ly:337,rx:241,ry:338,over:.3,blink:0,belly:.6}],
      [85,neutral],
    ]),
    yawn: action([
      [8,{dx:2,dy:4,tilt:4,swayY:2,rx:219,ry:278,over:1,blink:.55}],
      [19,{dx:1,dy:-4,tilt:7,swayY:0,rx:210,ry:263,blink:1,mouth:1,ly:332}],
      [26,{dx:3,dy:-2,tilt:6,rx:210,ry:265,mouth:.72,ly:333}],
      [33,{dy:4,tilt:3,rx:229,ry:297,mouth:.1,blink:.92}],
      [47,neutral],
    ]),
    nap: action([
      [12,{dx:-4,dy:9,tilt:-6,lean:-3,swayY:2,lx:143,ly:347,rx:237,ry:346,blink:.8}],
      [23,{dx:-7,dy:13,tilt:-10,lean:-3,swayY:4,lx:149,ly:349,rx:231,ry:347,blink:1}],
      [39,{dy:10,swayY:2,tilt:-9,belly:-1}],
      [55,{dy:13,swayY:4,tilt:-10,belly:0}],
      [70,{dy:10,swayY:2,tilt:-9,belly:-1}],
      [83,{dx:-1,dy:-2,swayY:-1,tilt:1,blink:.85,lx:145,ly:331,rx:237,ry:331}],
      [95,neutral],
    ]),
    showNote: action([
      [9,{dy:4,tilt:3,lx:142,ly:319,rx:247,ry:320,note:.1}],
      [18,{dy:-2,tilt:-3,lx:153,ly:306,rx:239,ry:307,note:1,joy:.65}],
      [32,{dy:0,tilt:-1,lx:151,ly:308,rx:241,ry:309,joy:.6}],
      [43,{dy:3,tilt:2,lx:143,ly:325,rx:245,ry:325,note:.48,joy:.2,blink:.8}],
      [52,neutral],
    ]),
    read: action([
      [11,{dy:5,tilt:4,lx:146,ly:332,rx:247,ry:329,book:.65}],
      [21,{dx:-1,dy:8,tilt:5,lx:150,ly:333,rx:238,ry:330,book:1}],
      [34,{dy:10,tilt:-2,rx:214,ry:301,page:.5,over:.72}],
      [41,{dy:9,tilt:-3,rx:204,ry:308,page:1,over:.6}],
      [49,{dy:6,tilt:-2,rx:240,ry:333,over:0,page:0,blink:.48}],
      [60,{dy:2,tilt:1,book:.33,lx:146,ly:336,rx:242,ry:336,blink:0}],
      [69,neutral],
    ]),
    greet: action([
      [8,{dx:-2,dy:0,tilt:-4,rx:289,ry:259,over:1,rightWave:.5,joy:.45}],
      [14,{tilt:-4,rx:300,ry:245,rightWave:.6}],
      [20,{tilt:-3,rx:283,ry:249,rightWave:.57}],
      [26,{tilt:-3,rx:306,ry:243,rightWave:.75}],
      [32,{tilt:-2,rx:286,ry:249,rightWave:.55}],
      [40,{dy:2,tilt:1,rx:258,ry:300,over:.3,rightWave:.15,joy:.12}], [49,neutral],
    ]),
    wink: action([
      [8,{dx:3,dy:0,tilt:7,lean:3,rx:258,ry:288,over:.72}],
      [12,{dx:3,dy:-1,tilt:8,rx:263,ry:272,wink:1,joy:.41}],
      [23,{tilt:6,rx:259,ry:274,wink:1}],
      [29,{dy:1,tilt:3,rx:249,ry:298,wink:0,joy:.21}], [38,neutral],
    ]),
    heart: action([
      [9,{dy:3,tilt:2,lx:157,ly:319,rx:227,ry:319}],
      [18,{dy:-2,tilt:-3,lx:175,ly:301,rx:216,ry:301,heart:1,joy:.68,over:.5}],
      [28,{dy:0,tilt:-1,lx:176,ly:301,rx:214,ry:302,heart:.85,joy:.65}],
      [36,{dy:1,tilt:1,lx:172,ly:308,rx:219,ry:308,heart:.55,joy:.3}],
      [49,neutral],
    ]),
    surprise: action([
      [5,{swayY:-4,dy:-2,tilt:-4,lx:113,ly:291,rx:273,ry:288,over:.78,mouth:.66,belly:2}],
      [12,{swayY:-5,dy:-2,tilt:3,lx:115,ly:291,rx:268,ry:292,mouth:.56,belly:1}],
      [20,{swayY:3,dy:4,tilt:2,lx:136,ly:332,rx:248,ry:332,over:.25,mouth:.15,blink:.6}], [31,neutral],
    ]),
    celebrate: action([
      [6,{swayY:2,dy:4,tilt:3,ly:329,ry:330,blink:.65}],
      [15,{swayY:-4,dy:-2,tilt:-4,lx:110,ly:239,rx:277,ry:235,joy:1,over:1,wave:.54,blink:.94}],
      [22,{swayY:-4,dy:-1,tilt:2,lx:107,ly:247,rx:279,ry:238,joy:.92,blink:.83}],
      [30,{swayY:-4,dy:-2,tilt:-2,lx:111,ly:238,rx:278,ry:241,joy:1,blink:.97}],
      [38,{swayY:3,dy:3,tilt:2,lx:141,ly:332,rx:239,ry:334,wave:0,over:.25,blink:.17,joy:.44}], [49,neutral],
    ]),
    landing: action([
      [6,{swayY:4,dy:7,tilt:4,lx:146,ly:344,rx:241,ry:344,blink:.82,belly:2}],
      [13,{swayY:-2,dy:-4,tilt:-3,ly:331,ry:331,blink:0,belly:-2,joy:.4}],
      [21,{swayY:1,dy:2,tilt:1,ly:336,ry:336,belly:1,joy:.17}], [30,neutral],
    ]),
    // A drag can last arbitrarily long, so its still pose breathes in a loop.
    held: poses(neutral, [
      [0,{swayY:-3,tilt:-3,belly:3,lx:137,ly:322,rx:250,ry:321,mouth:.19}],
      [16,{swayY:-5,tilt:2,belly:-3,lx:138,ly:321,rx:248,ry:321,mouth:.15}],
      [32,{swayY:-3,tilt:-3,belly:3,lx:137,ly:322,rx:250,ry:321,mouth:.19}],
    ]),
  };
};
