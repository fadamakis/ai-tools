import test from 'node:test';
import assert from 'node:assert/strict';
import {nextVersion} from '../../scripts/release.mjs';
test('release versions increase from published versions and honor explicit upgrades',()=>{
 assert.equal(nextVersion('0.11.3'), '0.11.3');
 assert.equal(nextVersion('0.11.3','0.11.3'),'0.11.4');
 assert.equal(nextVersion('0.11.3','0.11.9'),'0.11.10');
 assert.equal(nextVersion('0.12.0','0.11.9'),'0.12.0');
 assert.equal(nextVersion('1.0.0','0.12.0'),'1.0.0');
 assert.throws(()=>nextVersion('local'),/Invalid version/);
});
