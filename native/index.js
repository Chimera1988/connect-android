import { registerRootComponent } from 'expo';
import App from './src/App';
import { installNativePushBackgroundHandlers } from './src/ConnectNativePush';
installNativePushBackgroundHandlers();
registerRootComponent(App);
