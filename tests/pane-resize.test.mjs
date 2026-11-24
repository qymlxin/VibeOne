import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paneDrag,paneRelease} from '../apps/desktop/src/pane-resize.ts';

test('one continuous gesture collapses and restores at half the minimum',()=>{
 for(const minimum of [200,280]){
  const positions=[minimum,minimum*.75,minimum*.5,minimum*.25,minimum*.5,minimum*.75,minimum];
  const states=positions.map(width=>paneDrag(width,minimum,900));
  assert.deepEqual(states.map(state=>state.collapsed),[false,false,true,true,true,false,false]);
  assert.deepEqual(states.map(state=>state.opacity),[1,.5,0,0,0,.5,1]);
  assert.equal(paneRelease(minimum*.75,minimum,900).width,minimum);
  assert.equal(paneRelease(minimum*.5,minimum,900).width,0);
 }
});
test('bounds keep the pane within available space, including narrow windows',()=>{
 assert.equal(paneRelease(1200,280,600).width,600);
 assert.equal(paneDrag(-20,280,600).width,0);
 assert.equal(paneRelease(180,280,200).width,200);
 assert.equal(paneRelease(10,280,0).width,0);
});
