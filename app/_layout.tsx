import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Caveat_700Bold, useFonts } from '@expo-google-fonts/caveat';
import { ActivityIndicator, View } from 'react-native';

import { colors } from '../src/theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Caveat_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.rose} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.paper },
        }}
      />
    </>
  );
}
