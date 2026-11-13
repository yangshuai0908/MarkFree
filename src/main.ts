import { createApp } from 'vue'
import {
  Button,
  Checkbox,
  Input,
  Layout,
  Progress,
  Radio,
  Slider,
  Switch,
} from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'

import App from './App.vue'

const app = createApp(App)

for (const component of [Button, Checkbox, Input, Layout, Progress, Radio, Slider, Switch]) {
  app.use(component)
}

app.mount('#app')
