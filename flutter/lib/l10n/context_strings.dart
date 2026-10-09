/// BuildContext sugar for reading the active [AppStrings].
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'strings.dart';
import '../state/app_settings.dart';

extension ContextStrings on BuildContext {
  /// The strings for the current app language.
  AppStrings get strings => read<AppSettings>().strings;
}
