def execute():
	"""Sites installed fresh never ran enable_pos_change_gl_entries (an install marks its
	patches done without running them), so every cash sale that gives change was refused.
	Switch it on here, once, on every site; already on, this changes nothing."""
	from xpos.install import enable_change_gl_entries

	if enable_change_gl_entries():
		print("Enabled POS Settings.post_change_gl_entries: cash sales that give change can post.")
