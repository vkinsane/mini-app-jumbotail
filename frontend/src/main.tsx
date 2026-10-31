import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import './index.css'
import App from './App.tsx'

const theme = createTheme({
  palette: {
    primary: { main: '#d84315' },
    secondary: { main: '#00695c' },
    background: { default: '#f6f4f1' },
  },
  shape: { borderRadius: 10 },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
