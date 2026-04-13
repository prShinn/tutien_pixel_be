package com.tutien.pixel.services;

import com.tutien.pixel.entities.canhGioiEntity;
import com.tutien.pixel.entities.dtos.PlayerDto;
import com.tutien.pixel.entities.playerEntity;
import com.tutien.pixel.entities.skillEntity;
import com.tutien.pixel.repositories.CanhGioiRepository;
import com.tutien.pixel.repositories.PlayerRepository;
import com.tutien.pixel.repositories.SkillRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class PlayerService {

    @Autowired
    private PlayerRepository repo;
    @Autowired
    private SkillRepository skillRepo;
    @Autowired
    private CanhGioiRepository canhGioiRepo;

    public List<playerEntity> all() {
        return repo.findAll();
    }

    public Optional<playerEntity> get(int id) {
        return repo.findById(id);
    }

    public Optional<playerEntity> getByUser(int id) {
        return repo.findByUserId(id);
    }

    public PlayerDto getPlayerDto(int id) {
        playerEntity p = repo.findById(id)
                .orElseThrow(() -> new RuntimeException("Player not found"));

        List<skillEntity> skills = skillRepo.findByLinhCan(p.getLinhCan());
        canhGioiEntity canhGioi = canhGioiRepo.findByCode(p.getMaCanhGioi());

        return new PlayerDto(
                p.getId(),
                p.getUserId(),
                p.getStats(),
                p.getName(),
                p.getLinhCan(),
                canhGioi.getName(),
                p.getTangTuVi(),
                p.getMaCanhGioi(),
                p.getHp(),
                p.getMaxHp(),
                p.getMp(),
                p.getMaxMp(),
                p.getXu(),
                p.getTuViHienTai(),
                p.getTuViLenCap(),
                p.getX(),
                p.getY(),
                p.getPx(),
                p.getPy(),
                p.getMapCode(),
                p.getTrangBi(),
                p.getIventoryIndex(),
                p.getAttackCD(),
                p.getHeal_hp(),
                p.getHeal_mp(),
                p.getJsonIventory(),
                p.getCrit(),
                (int) p.getSpeed(),
                p.getEquip_slot(),
                skills,
                canhGioi
        );
    }


    public playerEntity create(playerEntity e) {
        return repo.save(e);
    }

    public playerEntity update(int id, playerEntity u) {
        playerEntity existingPlayer = repo.findById(id)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy người chơi với ID: " + id));

        // 2. Cập nhật các trường cơ bản
//        existingPlayer.setName(u.getName());
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
        existingPlayer.setTuViLenCap(u.getTuViLenCap());
        // 4. Cập nhật tài nguyên & kinh nghiệm
        existingPlayer.setXu(u.getXu());
        existingPlayer.setTuViHienTai(u.getTuViHienTai());

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
