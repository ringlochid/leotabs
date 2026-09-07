# SPDX-License-Identifier: MPL-2.0
# Keep the Windows entry point; the canonical artwork is extension/icons/lion.svg.
& node (Join-Path $PSScriptRoot 'icons.mjs') @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
