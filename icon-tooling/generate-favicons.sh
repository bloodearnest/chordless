#!/bin/bash
# Run from this directory (the justfile does)
# Generate favicon variants from the transparent base

# Generate light mode: swap symbol color to darker blue (for visibility on light backgrounds)
cat favicon-base.svg | \
  sed 's/fill:#3498db/fill:#2980b9/g' | \
  npx svgo --input - --output ../public/icons/favicon-light.svg

# Generate dark mode: keep symbol bright blue (same as base)
cat favicon-base.svg | \
  npx svgo --input - --output ../public/icons/favicon-dark.svg

echo "Generated public/icons/favicon-light.svg and favicon-dark.svg"
