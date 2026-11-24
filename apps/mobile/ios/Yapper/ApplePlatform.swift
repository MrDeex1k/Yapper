import Foundation

#if os(iOS)
import YapperShared

typealias CommunityClient = MobileClient
typealias CommunityState = MobileState
typealias CredentialStore = DeviceStore

func appleText(_ language: String, _ key: String) -> String { CopyKt.mobileText(locale: language, key: key) }
func validChatMessage(_ body: String) -> Bool { PendingSendsKt.validMessage(body: body) }
func chatMessageLength(_ body: String) -> Int32 { PendingSendsKt.messageLength(body: body) }
func staffSectionsForRole(_ role: String) -> [String] { StaffKt.staffSections(role: role) }
func appleBool(_ value: KotlinBoolean) -> Bool { value.boolValue }
#endif
