package com.tutien.pixel.services;

import com.tutien.pixel.entities.playerEntity;
import com.tutien.pixel.repositories.PlayerRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class PlayerService {

    @Autowired
    private PlayerRepository repo;

    public List<playerEntity> all() {
        return repo.findAll();
    }

    public Optional<playerEntity> get(int id) {
        return repo.findById(id);
    }
    public Optional<playerEntity> getByUser(int id) {
        return repo.findByUserId(id);
    }

    public playerEntity create(playerEntity e) {
        return repo.save(e);
    }

    public playerEntity update(int id, playerEntity u) {
        playerEntity existingPlayer = repo.findById(id)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy người chơi với ID: " + id));

        // 2. Cập nhật các trường cơ bản
        existingPlayer.setName(u.getName());
        existingPlayer.setLinhCan(u.getLinhCan());
        existingPlayer.setTenCanhGioi(u.getTenCanhGioi());
        existingPlayer.setMaCanhGioi(u.getMaCanhGioi());
        existingPlayer.setTangTuVi(u.getTangTuVi());

        // 3. Cập nhật chỉ số (Stats & HP/MP)
        existingPlayer.setHp(u.getHp());
        existingPlayer.setMaxHp(u.getMaxHp());
        existingPlayer.setMp(u.getMp());
        existingPlayer.setMaxMp(u.getMaxMp());
        existingPlayer.setHeal_hp(u.getHeal_hp());
        existingPlayer.setHeal_mp(u.getHeal_mp());

        // 4. Cập nhật tài nguyên & kinh nghiệm
        existingPlayer.setXu(u.getXu());
        existingPlayer.setTuViHienTai(u.getTuViHienTai());
        existingPlayer.setTuViLenCap(u.getTuViLenCap());

        // 5. Cập nhật vị trí & Map
        existingPlayer.setX(u.getX());
        existingPlayer.setY(u.getY());
        existingPlayer.setPx(u.getPx());
        existingPlayer.setPy(u.getPy());
        existingPlayer.setMapCode(u.getMapCode());

        // 6. Cập nhật Embeddable và JSON (Inventory/Trang bị)
        existingPlayer.setStats(u.getStats());
        existingPlayer.setTrangBi(u.getTrangBi());
        existingPlayer.setIventoryIndex(u.getIventoryIndex());
        existingPlayer.setJsonIventory(u.getJsonIventory());
        existingPlayer.setAttackCD(u.getAttackCD());

        // 7. Lưu vào Database
        return repo.save(existingPlayer);
    }

    public void updatePosition(int id, int x, int y, String mapCode) {
        repo.findById(id).ifPresent(p -> {
            p.setX(x);
            p.setY(y);
            p.setMapCode(mapCode);
            repo.save(p);
        });
    }
    public void delete(int id) {
        repo.deleteById(id);
    }
}
