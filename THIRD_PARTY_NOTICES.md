# Third-Party Notices

The original application code in this repository is licensed under the MIT License. Third-party software remains under the license chosen by its respective authors.

This notice is informational and is not legal advice. Review upstream license texts before redistributing packaged copies, binaries, Docker images, or modified dependency code.

## Vendored Frontend Dependency

- Three.js r164
  - License: MIT
  - Copyright: 2010-2024 Three.js Authors
  - Vendored file: `static/vendor/three.module.min.js`
  - Upstream: https://github.com/mrdoob/three.js
  - Notes: The vendored file keeps its SPDX/MIT license header.

## Direct Python Dependencies

- Flask 3.0.3
  - License: BSD License
  - Upstream: https://github.com/pallets/flask

- gunicorn 22.0.0
  - License: MIT
  - Upstream: https://github.com/benoitc/gunicorn

- kociemba 1.2.1
  - License: GPLv2
  - Upstream: https://github.com/muodov/kociemba
  - Notes: This dependency is used for Rubik's Cube solving. Its GPLv2 license is the main reason the full running dependency stack should not be described as purely MIT/permissive without qualification.

- numpy 1.24.4
  - License: BSD-3-Clause
  - Upstream: https://github.com/numpy/numpy

- opencv-python-headless 4.10.0.84
  - License: Apache 2.0
  - Upstream: https://github.com/opencv/opencv-python

## Notable Transitive Dependencies

These are installed by the direct Python dependencies in the current environment:

- blinker 1.8.2: MIT
- cffi 1.17.1: MIT
- click 8.1.8: BSD License
- future 1.0.0: MIT
- itsdangerous 2.2.0: BSD License
- Jinja2 3.1.6: BSD License
- MarkupSafe 2.1.5: BSD-3-Clause
- packaging 26.2: Apache-2.0 OR BSD-2-Clause
- pycparser 2.23: BSD-3-Clause
- Werkzeug 3.0.6: BSD License
