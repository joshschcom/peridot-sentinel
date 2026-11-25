// Prove a post-build source checkpoint by rebuilding a committed tree inside the repository.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256 } from 'viem';

export function verifyBuildCommit(root, ref, artifacts, sourceHashes, fixturePath, verifyAbi = false) {
  if (!/^[a-f0-9]{7,40}$/i.test(ref)) throw Error('Use a Git commit SHA for --source-commit');
  const git = (...args) => execFileSync('git', args, { cwd:root });
  const commit = git('rev-parse','--verify',ref + '^{commit}').toString().trim();
  for (const [path, expected] of sourceHashes) {
    const matched = git('show',commit + ':contracts/' + path);
    if (keccak256(matched) !== expected) throw Error(`Committed Solidity source mismatch: ${path}`);
  }
  const fixtureDigest = keccak256(git('show',commit + ':' + fixturePath));
  if (keccak256(readFileSync(resolve(root,fixturePath))) !== fixtureDigest) throw Error('Policy fixture differs from commit');

  const parent = resolve(root,'.research','source-checkpoints');
  mkdirSync(parent,{recursive:true});
  const dir = mkdtempSync(resolve(parent,commit.slice(0,8) + '-'));
  const archive = resolve(dir,'contracts.tar');
  git('archive','--output=' + archive,commit,'contracts/src','contracts/lib','contracts/script/DemoRateModel.sol','contracts/foundry.toml');
  execFileSync('tar',['-xf',archive,'-C',dir]);
  const foundryHash = keccak256(readFileSync(resolve(dir,'contracts/foundry.toml')));
  execFileSync('forge',['build','--offline'],{cwd:resolve(dir,'contracts'),stdio:['ignore','pipe','pipe']});
  for (const [name, original] of artifacts) {
    const copy = JSON.parse(readFileSync(resolve(dir,`contracts/out/${name}.sol/${name}.json`),'utf8'));
    if (verifyAbi && JSON.stringify(copy.abi) !== JSON.stringify(original.abi)) {
      throw Error(`Committed build ABI differs for ${name}`);
    }
    if (copy.bytecode.object !== original.bytecode.object || copy.deployedBytecode.object !== original.deployedBytecode.object) {
      throw Error(`Committed build differs for ${name}`);
    }
  }
  return { commit, ...(verifyAbi ? {abiVerified:true} : {}), sourceCount:sourceHashes.size, artifactCount:artifacts.size, foundryConfigKeccak256:foundryHash,
    policyFixturesKeccak256:fixtureDigest, compiler:artifacts.get('MarketFactory').metadata.compiler.version,
    verification:'All transitive source hashes matched. Isolated rebuild of the committed source and Foundry configuration reproduced all compared creation and runtime bytecode.' };
}
