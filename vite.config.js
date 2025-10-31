import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true
      }
    }
  }
})
```

---

## 📄 FILE 4: .gitignore

**Location:** `fpl-predictor/.gitignore`
```
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Build outputs
dist/
build/
.netlify/

# Development
.DS_Store
.env
.env.local
.env.production

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*

# Testing
coverage/
.nyc_output/

# Misc
.cache/
temp/