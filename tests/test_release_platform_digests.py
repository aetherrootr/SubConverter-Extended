"""Execute the release digest resolution step against representative OCI indexes."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleasePlatformDigestsTest(unittest.TestCase):
    def resolve(self, manifests):
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        step = workflow.split('      - name: Resolve platform image digests\n', 1)[1]
        step = step.split('      - name:', 1)[0]
        script = textwrap.dedent(step.split('        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'manifests': manifests}))
            docker = root / 'docker'
            docker.write_text('#!/usr/bin/env python3\nimport os\nfrom pathlib import Path\nprint(Path(os.environ["FIXTURE_MANIFEST"]).read_text())\n')
            docker.chmod(0o755)
            output = root / 'output'
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                   'FIXTURE_MANIFEST': str(root / 'manifest.json'),
                   'RUNNER_TEMP': str(root), 'GITHUB_OUTPUT': str(output),
                   'IMAGE_DIGEST': 'sha256:' + 'f' * 64}
            result = subprocess.run(['bash', '-c', script], env=env,
                                    capture_output=True, text=True)
            values = dict(line.split('=', 1) for line in output.read_text().splitlines())
            return result, values

    @staticmethod
    def manifest(arch, digit, os_name='linux'):
        return {'platform': {'os': os_name, 'architecture': arch},
                'digest': 'sha256:' + digit * 64}

    def test_selects_distinct_platforms_and_ignores_attestations(self):
        result, values = self.resolve([self.manifest('arm64', 'a'),
                                      self.manifest('unknown', 'b', 'unknown'),
                                      self.manifest('amd64', 'c')])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(values, {'digest': 'sha256:' + 'f' * 64,
                                 'amd64': 'sha256:' + 'c' * 64,
                                 'arm64': 'sha256:' + 'a' * 64})

    def test_missing_arm64_fails_before_smoke_or_promotion(self):
        result, _ = self.resolve([self.manifest('amd64', 'c')])
        self.assertNotEqual(result.returncode, 0)

    def test_ambiguous_arm64_fails_before_smoke_or_promotion(self):
        result, _ = self.resolve([self.manifest('amd64', 'c'),
                                 self.manifest('arm64', 'a'),
                                 self.manifest('arm64', 'b')])
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
