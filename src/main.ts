import { createApp } from 'vue'
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Input,
  Layout,
  Progress,
  Radio,
  Row,
  Select,
  Slider,
  Tag,
} from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'

import App from './App.vue'

const app = createApp(App)

for (const component of [Button, Card, Checkbox, Col, Divider, Input, Layout, Progress, Radio, Row, Select, Slider, Tag]) {
  app.use(component)
}

app.mount('#app')
