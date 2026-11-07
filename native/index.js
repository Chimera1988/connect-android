import { registerRootComponent } from 'expo';
import App from './src/App';
import {installTelecomEventHandlers} from './src/ConnectNativeTelecom';
installTelecomEventHandlers();
import { installNativePushBackgroundHandlers } from './src/ConnectNativePush';
installNativePushBackgroundHandlers();
registerRootComponent(App);
